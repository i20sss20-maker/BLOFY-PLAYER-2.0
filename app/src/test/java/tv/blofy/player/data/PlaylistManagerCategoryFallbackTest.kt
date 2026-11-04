package tv.blofy.player.data

import androidx.room.Room
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
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
import tv.blofy.player.data.remote.XtreamClient
import java.util.concurrent.ConcurrentHashMap

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28], application = tv.blofy.player.data.local.InMemoryKeystoreApplication::class)
class PlaylistManagerCategoryFallbackTest {
    private lateinit var db: BlofyDatabase

    @Before fun setup() {
        db = Room.inMemoryDatabaseBuilder(
            RuntimeEnvironment.getApplication(), BlofyDatabase::class.java
        ).build()
    }

    @After fun cleanup() { db.close() }

    @Test fun truncatedGlobalLiveAndSeriesRecoverWithCompleteCategoryRequests(): Unit = runBlocking(Dispatchers.IO) {
        MockWebServer().use { server ->
            val counts = ConcurrentHashMap<String, Int>()
            // A global stream fails AFTER a batch has already reached SQLite/FTS.
            val partial = (1..750).joinToString(",") {
                """{"stream_id":$it,"name":"Interrupted","category_id":"1"}"""
            }
            server.dispatcher = object : Dispatcher() {
                override fun dispatch(req: RecordedRequest): MockResponse {
                    val action = req.requestUrl?.queryParameter("action").orEmpty()
                    val category = req.requestUrl?.queryParameter("category_id")
                    counts.merge("$action:${category ?: "all"}", 1, Int::plus)
                    val body = when {
                        action == "get_live_categories" || action == "get_series_categories" ->
                            """[{"category_id":"1","category_name":"One"},{"category_id":"2","category_name":"Two"}]"""
                        action == "get_vod_categories" || action == "get_vod_streams" -> "[]"
                        action == "get_live_streams" && category == null -> "[$partial,{"
                        action == "get_series" && category == null ->
                            """[{"series_id":900,"category_id":"1","name":"Interrupted series"},"""
                        action == "get_live_streams" && category == "1" ->
                            """[{"stream_id":1,"category_id":"1","name":"Channel 1"}]"""
                        action == "get_live_streams" && category == "2" ->
                            """[{"stream_id":2,"category_id":"2","name":"Channel 2"}]"""
                        action == "get_series" && category == "1" ->
                            """[{"series_id":11,"category_id":"1","name":"Series 1"}]"""
                        action == "get_series" && category == "2" ->
                            """[{"series_id":12,"category_id":"2","name":"Series 2"}]"""
                        else -> "[]"
                    }
                    return MockResponse().setBody(body)
                }
            }
            server.start()
            val provider = ProviderEntity("split-test", "BLOFY", server.url("/").toString(), "user", "pass")
            val manager = PlaylistManager(XtreamClient.createApi(OkHttpClient()), db.dao())
            val result = manager.syncAll(provider)
            assertEquals(0, result.failedSectionCount)
            assertEquals(4, result.freshItemCount)
            assertEquals(listOf("1", "2"), db.dao().streamSnapshot(provider.id, "live").map { it.remoteId }.sorted())
            assertEquals(listOf("11", "12"), db.dao().streamSnapshot(provider.id, "series").map { it.remoteId }.sorted())
            assertEquals(2, counts["get_live_streams:all"])
            assertEquals(2, counts["get_series:all"])
            assertEquals(1, counts["get_live_streams:1"])
            assertEquals(1, counts["get_live_streams:2"])
            assertEquals(1, counts["get_series:1"])
            assertEquals(1, counts["get_series:2"])
            assertTrue(db.dao().searchStreamsFts(provider.id, "Interrupted*", 20).isEmpty())
        }
    }

    @Test fun permanentMissingCategoryNeverClaimsCompleteLibrary(): Unit = runBlocking(Dispatchers.IO) {
        MockWebServer().use { server ->
            server.dispatcher = object : Dispatcher() {
                override fun dispatch(req: RecordedRequest): MockResponse {
                    val action = req.requestUrl?.queryParameter("action").orEmpty()
                    val category = req.requestUrl?.queryParameter("category_id")
                    return when {
                        action == "get_live_categories" ->
                            MockResponse().setBody("""[{"category_id":"1","category_name":"One"}]""")
                        action == "get_live_streams" && category == null ->
                            MockResponse().setBody("""[{"stream_id":1},""")
                        action == "get_live_streams" && category != null ->
                            MockResponse().setResponseCode(404).setBody("Unavailable")
                        action.endsWith("_categories") || action == "get_vod_streams" || action == "get_series" ->
                            MockResponse().setBody("[]")
                        else -> MockResponse().setBody("[]")
                    }
                }
            }
            server.start()
            val provider = ProviderEntity("missing-category", "BLOFY", server.url("/").toString(), "u", "p")
            val result = PlaylistManager(XtreamClient.createApi(OkHttpClient()), db.dao()).syncAll(provider)
            assertEquals(1, result.failedSectionCount)
            assertTrue(result.safeFailureMessage().contains("القنوات"))
            assertTrue(result.safeFailureMessage().contains("404"))
            assertEquals(0, db.dao().catalogCountAll(provider.id, "live"))
        }
    }
}
