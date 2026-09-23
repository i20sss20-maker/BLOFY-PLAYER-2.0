package tv.blofy.player.data

import android.app.Application
import androidx.room.Room
import com.google.gson.JsonElement
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.ResponseBody
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import tv.blofy.player.data.local.BlofyDatabase
import tv.blofy.player.data.local.ProviderEntity
import tv.blofy.player.data.local.StreamEntity
import tv.blofy.player.data.local.StreamSearchFtsEntity
import tv.blofy.player.data.remote.XtreamApi

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28], application = tv.blofy.player.data.local.InMemoryKeystoreApplication::class)
class PlaylistManagerPersistenceTest {
    private lateinit var db: BlofyDatabase
    private val provider = ProviderEntity("candidate", "Candidate", "https://fixture.example.test", "u", "p")

    @Before fun setup() {
        db = Room.inMemoryDatabaseBuilder(RuntimeEnvironment.getApplication(), BlofyDatabase::class.java).build()
    }

    @After fun cleanup() = db.close()

    @Test fun failedSearchWriteCannotLeaveAHalfSavedCatalogBatch(): Unit = runBlocking(Dispatchers.IO) {
        val stream = StreamEntity("batch:movie:1", "batch", "1", null, "movie", "Fixture")
        db.openHelper.writableDatabase.execSQL("DROP TABLE streams_fts")
        try {
            db.dao().insertCatalogBatch(listOf(stream),
                listOf(StreamSearchFtsEntity(stream.key, stream.providerId, stream.kind, "fixture")))
            fail("Missing FTS table must reject the batch")
        } catch (_: android.database.sqlite.SQLiteException) { }
        assertEquals("The catalog row must roll back with its failed search entry", 0,
            db.dao().streamCountForProvider("batch"))
    }

    @Test fun rejectedCategoryPayloadIsReportedAsFailedAndCannotClaimFreshRows(): Unit = runBlocking(Dispatchers.IO) {
        val api = FixtureApi(liveCategories = listOf(mapOf("category_name" to "Missing identifier")))

        val result = PlaylistManager(api, db.dao()).syncAll(provider)

        assertEquals(1, result.failedSectionCount)
        assertEquals(2, result.freshItemCount)
        assertEquals(0, db.dao().catalogCountAll(provider.id, "live"))
        assertTrue(db.dao().categorySnapshot(provider.id, "live").isEmpty())
        assertEquals(2, db.dao().streamCountForProvider(provider.id))
        assertTrue(db.dao().searchStreamsFts(provider.id, "Live*", 10).isEmpty())
    }

    @Test fun unparseableStreamPayloadCountsAsFailureWhileValidSectionsRemainStaged(): Unit = runBlocking(Dispatchers.IO) {
        val result = PlaylistManager(FixtureApi(liveStreams = "[{\"name\":\"Missing identifier\"}]"), db.dao())
            .syncAll(provider)

        assertEquals(1, result.failedSectionCount)
        assertEquals(2, result.freshItemCount)
        assertEquals(0, db.dao().catalogCountAll(provider.id, "live"))
        assertEquals(2, db.dao().streamCountForProvider(provider.id))
    }

    @Test fun rejectedEmptyRefreshKeepsExistingRowsAndReportsFailure(): Unit = runBlocking(Dispatchers.IO) {
        val saved = StreamEntity("candidate:live:saved", provider.id, "saved", null, "live", "Saved live", favorite = true)
        db.dao().replaceCatalog(provider.id, "live", emptyList(), listOf(saved))

        val result = PlaylistManager(FixtureApi(liveCategories = emptyList(), liveStreams = "[]"), db.dao())
            .syncAll(provider)

        assertEquals(1, result.failedSectionCount)
        assertEquals(saved, db.dao().stream(saved.key))
        assertEquals(listOf(saved), db.dao().searchStreamsFts(provider.id, "Saved*", 10))
    }

    @Test fun legitimatelyEmptyNewSectionDoesNotFailOtherSupportedKinds(): Unit = runBlocking(Dispatchers.IO) {
        val result = PlaylistManager(FixtureApi(liveCategories = emptyList(), liveStreams = "[]"), db.dao())
            .syncAll(provider)

        assertEquals(0, result.failedSectionCount)
        assertEquals(2, result.freshItemCount)
        assertEquals(2, db.dao().streamCountForProvider(provider.id))
    }

    @Test fun movieTerminalProgressIsPublishedOnlyAfterRowsAreDurable(): Unit = runBlocking(Dispatchers.IO) {
        val manager = PlaylistManager(FixtureApi(), db.dao())
        var rowsWhenTerminalProgressArrived = -1

        val count = manager.syncVod(provider) { progress ->
            if (progress == 88) {
                rowsWhenTerminalProgressArrived = db.dao().catalogCountAll(provider.id, "movie")
            }
        }

        assertEquals(1, count)
        assertEquals("88% must mean the movie section is already durable", 1, rowsWhenTerminalProgressArrived)
    }

    @Test fun interruptedBodyRetriesOnlyItsSectionAndRemovesPartialRows(): Unit = runBlocking(Dispatchers.IO) {
        okhttp3.mockwebserver.MockWebServer().use { server ->
            val calls = java.util.concurrent.ConcurrentHashMap<String, Int>()
            // Exceed the current 2000-row batch so the failed response has already reached Room/FTS.
            val partial = (1..2600).joinToString(",") { "{\"stream_id\":$it,\"name\":\"Partial $it\"}" }
            server.dispatcher = object : okhttp3.mockwebserver.Dispatcher() {
                override fun dispatch(request: okhttp3.mockwebserver.RecordedRequest): okhttp3.mockwebserver.MockResponse {
                    val action = request.requestUrl!!.queryParameter("action")!!
                    val count = calls.merge(action, 1, Int::plus)!!
                    val body = when {
                        action.endsWith("categories") -> "[]"
                        action == "get_vod_streams" && count == 1 -> "[$partial,{\"stream_id\":"
                        action == "get_series" -> "[{\"series_id\":1,\"name\":\"Series\"}]"
                        else -> "[{\"stream_id\":999,\"name\":\"Complete\"}]"
                    }
                    return okhttp3.mockwebserver.MockResponse().setBody(body)
                }
            }
            server.start()
            val api = tv.blofy.player.data.remote.XtreamClient.createApi(okhttp3.OkHttpClient())
            val local = provider.copy(baseUrl = server.url("/").toString())
            val manager = PlaylistManager(api, db.dao())
            assertEquals(1, CatalogSectionRetry.run { manager.syncVod(local) })
            val completed = mutableListOf<String>()
            val result = manager.syncAll(local, completedSections = setOf("movie"),
                onSectionComplete = { completed += it })
            assertEquals(0, result.failedSectionCount)
            assertEquals(3, result.freshItemCount)
            assertEquals(listOf("live", "movie", "series"), completed)
            assertEquals(2, calls["get_vod_streams"])
            assertEquals(1, calls["get_live_streams"])
            assertEquals(1, calls["get_series"])
            assertEquals(listOf("999"), db.dao().streamSnapshot(provider.id, "movie").map { it.remoteId })
            assertTrue(db.dao().searchStreamsFts(provider.id, "Partial*", 10).isEmpty())
        }
    }

    private class FixtureApi(
        val liveCategories: List<Map<String, Any?>> = listOf(mapOf("category_id" to "1", "category_name" to "Category")),
        val liveStreams: String = "[{\"stream_id\":1,\"name\":\"Live item\",\"category_id\":1}]"
    ) : XtreamApi {
        override suspend fun list(url: String): List<Map<String, Any?>> =
            if (url.contains("action=get_live_categories")) liveCategories
            else listOf(mapOf("category_id" to "1", "category_name" to "Category"))

        override fun streamingCall(url: String): retrofit2.Call<ResponseBody> {
            val payload = when {
                url.contains("action=get_live_streams") -> liveStreams
                url.contains("action=get_vod_streams") -> "[{\"stream_id\":1,\"name\":\"Movie item\",\"category_id\":1}]"
                else -> "[{\"series_id\":1,\"name\":\"Series item\",\"category_id\":1}]"
            }
            return FixtureCall(payload)
        }

        override suspend fun objectResponse(url: String): Map<String, Any?> = error("Unexpected EPG request")
        override suspend fun jsonResponse(url: String): JsonElement = error("Unexpected detail request")
    }

    private class FixtureCall(private val payload: String) : retrofit2.Call<ResponseBody> {
        private var cancelled = false
        private var executed = false
        override fun enqueue(callback: retrofit2.Callback<ResponseBody>) {
            executed = true
            callback.onResponse(this, execute())
        }
        override fun execute() = retrofit2.Response.success(payload.toResponseBody("application/json".toMediaType()))
        override fun cancel() { cancelled = true }
        override fun isCanceled() = cancelled
        override fun isExecuted() = executed
        override fun clone(): retrofit2.Call<ResponseBody> = FixtureCall(payload)
        override fun request() = okhttp3.Request.Builder().url("https://fixture.example.test").build()
        override fun timeout() = okio.Timeout.NONE
    }
}
