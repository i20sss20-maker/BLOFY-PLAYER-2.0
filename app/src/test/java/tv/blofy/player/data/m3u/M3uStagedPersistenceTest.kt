package tv.blofy.player.data.m3u

import android.app.Application
import android.content.Context
import androidx.room.Room
import com.google.gson.JsonElement
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking
import okhttp3.ResponseBody
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.SocketPolicy
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import tv.blofy.player.data.PlaylistManager
import tv.blofy.player.data.local.*
import tv.blofy.player.data.remote.XtreamApi

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28], application = Application::class)
class M3uStagedPersistenceTest {
    private lateinit var context: Context
    private lateinit var db: BlofyDatabase
    private lateinit var server: MockWebServer
    private val databaseName = "m3u-staged-regression.db"
    private val unusedApi = object : XtreamApi {
        override suspend fun list(url: String): List<Map<String, Any?>> = error("M3U must not use Xtream")
        override suspend fun objectResponse(url: String): Map<String, Any?> = error("M3U must not use Xtream")
        override suspend fun streamingResponse(url: String): ResponseBody = error("M3U must not use Xtream")
        override suspend fun jsonResponse(url: String): JsonElement = error("M3U must not use Xtream")
    }

    @Before fun setup() {
        context = RuntimeEnvironment.getApplication()
        context.deleteDatabase(databaseName)
        db = openDatabase()
        server = MockWebServer().apply { start() }
    }
    @After fun tearDown() {
        db.close()
        context.deleteDatabase(databaseName)
        server.shutdown()
    }
    private fun openDatabase() = Room.databaseBuilder(context, BlofyDatabase::class.java, databaseName).build()
    private fun provider() = ProviderEntity("original", "Saved M3U", server.url("/list.m3u").toString(), "", "", providerType = "m3u")
    private fun playlist(count: Int, group: String = "News") = buildString {
        appendLine("#EXTM3U")
        repeat(count) { index ->
            appendLine("#EXTINF:-1 group-title=\"$group\",Channel $index")
            appendLine("https://fixture.example.test/$group/$index.ts")
        }
    }
    private fun truncated(body: String) = MockResponse().setBody(body)
        .setHeader("Content-Length", body.toByteArray(Charsets.UTF_8).size + 1024)
        .setSocketPolicy(SocketPolicy.DISCONNECT_AT_END)

    @Test fun failedRefreshDiscardsOnlyStagingAndPreservesSavedCatalogAndActivation(): Unit = runBlocking(Dispatchers.IO) {
        val original = provider()
        val dao = db.dao()
        dao.upsertProviderStored(original)
        val saved = StreamEntity("original:live:saved", original.id, "saved", null, "live", "Saved channel", favorite = true)
        dao.upsertStreams(listOf(saved))
        val activation = ActivationEntity("BLOFY-TEST-ABCD", "123456", activated = true)
        dao.upsertActivation(activation)
        repeat(3) { server.enqueue(truncated(playlist(1_000))) }
        val staged = original.copy(id = "staged", enabled = false)
        val failure = runCatching { PlaylistManager(unusedApi, dao).syncAll(staged) }.exceptionOrNull()
        assertNotNull(failure)
        assertEquals(saved, dao.stream(saved.key))
        assertEquals(1, dao.streamCountForProvider(original.id))
        assertEquals(0, dao.streamCountForProvider(staged.id))
        assertTrue(dao.allCategoriesForProvider(staged.id).isEmpty())
        assertEquals(activation, dao.activation())
        assertEquals(original, dao.provider(original.id))
    }

    @Test fun retryCannotLeaveOrphanRowsFromARejectedResponseInRoom(): Unit = runBlocking(Dispatchers.IO) {
        server.enqueue(truncated(playlist(1_000, "Discarded")))
        server.enqueue(MockResponse().setBody(playlist(10, "Accepted")))
        val staged = provider().copy(id = "staged", enabled = false)
        val dao = db.dao()
        val result = PlaylistManager(unusedApi, dao).syncAll(staged)
        assertEquals(10, result.freshItemCount)
        assertEquals(10, dao.streamCountForProvider(staged.id))
        assertTrue(dao.allStreamsForProvider(staged.id).all { it.directSource!!.contains("/Accepted/") })
        assertEquals(listOf("Accepted"), dao.allCategoriesForProvider(staged.id).map { it.name })
        assertEquals(10, dao.searchStreamsFts(staged.id, "Channel*", 20).size)
    }

    @Test fun promotedRefreshSurvivesDatabaseReopenWithFavoritesResumeAndSearch(): Unit = runBlocking(Dispatchers.IO) {
        val original = provider()
        var dao = db.dao()
        dao.upsertProviderStored(original)
        server.enqueue(MockResponse().setBody(playlist(1_000)))
        PlaylistManager(unusedApi, dao).syncAll(original)
        val chosen = dao.catalogPageAfterAll(original.id, "live", 0L, 1).single()
        dao.setFavorite(chosen.key, true)
        val resume = WatchStateEntity(chosen.key, original.id, "live", 45_000, 180_000)
        dao.saveWatchState(resume)
        server.enqueue(MockResponse().setBody(playlist(1_250)))
        val staged = original.copy(id = "staged", enabled = false)
        PlaylistManager(unusedApi, dao).syncAll(staged)
        dao.promoteStagedCatalog(staged.id, original)
        val requestsBeforeReopen = server.requestCount
        db.close()
        db = openDatabase()
        dao = db.dao()
        assertEquals(1_250, dao.streamCountForProvider(original.id))
        assertEquals(0, dao.streamCountForProvider(staged.id))
        assertEquals(true, dao.stream(chosen.key)?.favorite)
        assertEquals(resume, dao.watchState(chosen.key))
        assertEquals(10, dao.searchStreamsFts(original.id, "Channel*", 10).size)
        assertEquals(original, dao.provider(original.id))
        assertEquals(requestsBeforeReopen, server.requestCount)
    }
}
