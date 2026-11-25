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

    @Test fun sourceCatalogPagingRetainsReceivedOrderInsteadOfSortingByName(): Unit = runBlocking(Dispatchers.IO) {
        val received = listOf("Zeta", "Alpha", "Middle")
        val streams = received.mapIndexed { index, name ->
            StreamEntity("source:movie:${index + 1}", "source", "${index + 1}", null, "movie", name)
        }
        db.dao().insertCatalogBatch(streams, streams.map {
            StreamSearchFtsEntity(it.key, it.providerId, it.kind, it.name)
        })
        val saved = db.dao().catalogPageAfterAll("source", "movie", 0L, 10).map { it.name }
        assertEquals(received, saved)
        // A restart reads the same durable rows, without redownloading the source.
        assertEquals(saved, db.dao().catalogPageAfterAll("source", "movie", 0L, 10).map { it.name })
    }

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

    @Test fun interruptedBodyRetriesOnlyItsSectionAndRemovesPartialRows(): Unit = runBlocking(Dispatchers.IO) {
        okhttp3.mockwebserver.MockWebServer().use { server ->
            val calls = java.util.concurrent.ConcurrentHashMap<String, Int>()
            // Exceed the 700-row batch so the failed response has already reached Room/FTS.
            val partial = (1..1000).joinToString(",") { "{\"stream_id\":$it,\"name\":\"Partial $it\"}" }
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

    @Test fun truncatedWholeCatalogRecoversFromValidatedCategoryChunks(): Unit = runBlocking(Dispatchers.IO) {
        okhttp3.mockwebserver.MockWebServer().use { server ->
            val fullAttempts = java.util.concurrent.atomic.AtomicInteger()
            val categoriesRequested = mutableListOf<String>()
            server.dispatcher = object : okhttp3.mockwebserver.Dispatcher() {
                override fun dispatch(request: okhttp3.mockwebserver.RecordedRequest): okhttp3.mockwebserver.MockResponse {
                    val action = request.requestUrl!!.queryParameter("action")
                    val category = request.requestUrl!!.queryParameter("category_id")
                    val body = when (action) {
                        "get_live_categories" -> "[{\"category_id\":1,\"category_name\":\"Live\"}]"
                        "get_vod_categories", "get_series_categories" -> "[]"
                        "get_live_streams" -> {
                            if (category == null) {
                                fullAttempts.incrementAndGet()
                                return okhttp3.mockwebserver.MockResponse()
                                    .setBody("[{\"stream_id\":1,\"category_id\":1,\"name\":\"Interrupted first download\"}]")
                                    .setSocketPolicy(okhttp3.mockwebserver.SocketPolicy.DISCONNECT_DURING_RESPONSE_BODY)
                            }
                            synchronized(categoriesRequested) { categoriesRequested += category }
                            if (category == "1") "[{\"stream_id\":1,\"category_id\":1,\"name\":\"Recovered\"}]"
                            else "[]"
                        }
                        "get_vod_streams" -> "[{\"stream_id\":2,\"name\":\"Movie\"}]"
                        "get_series" -> "[{\"series_id\":3,\"name\":\"Series\"}]"
                        else -> "[]"
                    }
                    return okhttp3.mockwebserver.MockResponse().setBody(body)
                }
            }
            server.start()
            val api = tv.blofy.player.data.remote.XtreamClient.createApi(okhttp3.OkHttpClient())
            val local = provider.copy(baseUrl = server.url("/").toString())
            val result = PlaylistManager(api, db.dao()).syncAll(local)
            assertEquals(0, result.failedSectionCount)
            assertEquals(3, result.freshItemCount)
            assertEquals(3, fullAttempts.get())
            assertEquals(listOf("1", "0"), synchronized(categoriesRequested) { categoriesRequested.toList() })
            assertEquals("Recovered", db.dao().stream("${provider.id}:live:1")?.name)
            assertEquals(1, db.dao().catalogCountAll(provider.id, "live"))
        }
    }

    @Test fun ignoredCategoryFilterCannotPublishIncompleteLibrary(): Unit = runBlocking(Dispatchers.IO) {
        okhttp3.mockwebserver.MockWebServer().use { server ->
            server.dispatcher = object : okhttp3.mockwebserver.Dispatcher() {
                override fun dispatch(request: okhttp3.mockwebserver.RecordedRequest): okhttp3.mockwebserver.MockResponse {
                    val action = request.requestUrl!!.queryParameter("action")
                    val category = request.requestUrl!!.queryParameter("category_id")
                    val body = when (action) {
                        "get_live_categories" -> "[{\"category_id\":1,\"category_name\":\"Live\"}]"
                        "get_vod_categories", "get_series_categories" -> "[]"
                        "get_live_streams" -> {
                            if (category == null) return okhttp3.mockwebserver.MockResponse()
                                .setBody("[{\"stream_id\":1,\"category_id\":1,\"name\":\"Incomplete\"}]")
                                .setSocketPolicy(okhttp3.mockwebserver.SocketPolicy.DISCONNECT_DURING_RESPONSE_BODY)
                            "[{\"stream_id\":77,\"category_id\":99,\"name\":\"Unfiltered\"}]"
                        }
                        "get_vod_streams" -> "[{\"stream_id\":2,\"name\":\"Movie\"}]"
                        "get_series" -> "[{\"series_id\":3,\"name\":\"Series\"}]"
                        else -> "[]"
                    }
                    return okhttp3.mockwebserver.MockResponse().setBody(body)
                }
            }
            server.start()
            val local = provider.copy(baseUrl = server.url("/").toString())
            val result = PlaylistManager(
                tv.blofy.player.data.remote.XtreamClient.createApi(okhttp3.OkHttpClient()),
                db.dao()
            ).syncAll(local)
            assertEquals(1, result.failedSectionCount)
            assertEquals(2, result.freshItemCount)
            assertEquals(0, db.dao().catalogCountAll(provider.id, "live"))
            assertTrue(db.dao().searchStreamsFts(provider.id, "Incomplete*", 10).isEmpty())
            assertTrue(db.dao().searchStreamsFts(provider.id, "Unfiltered*", 10).isEmpty())
        }
    }

    @Test fun externalCatalogImportsBeyondPrototypeLimitWithoutStoringSourceUrls(): Unit = runBlocking(Dispatchers.IO) {
        val external = ProviderEntity("external-fixture", "External fixture",
            tv.blofy.player.data.remote.ExternalXtreamCatalogTransport.ORIGIN, "", "", enabled = false)
        val requests = mutableListOf<String>()
        val api = object : XtreamApi {
            override suspend fun list(url: String): List<Map<String, Any?>> {
                requests += url
                return listOf(mapOf("category_id" to "1", "category_name" to "Category"))
            }
            override fun streamingCall(url: String): retrofit2.Call<ResponseBody> {
                requests += url
                val payload = when {
                    url.contains("action=get_live_streams") ->
                        "[{\"stream_id\":1,\"category_id\":1,\"name\":\"Live\",\"direct_source\":\"https://untrusted.example.com/secret\"}]"
                    url.contains("action=get_vod_streams") ->
                        (1..20001).joinToString(",", "[", "]") { id ->
                            "{\"stream_id\":$id,\"category_id\":1,\"name\":\"Movie $id\",\"container_extension\":\"mkv\",\"stream_icon\":\"https://untrusted.example.com/secret\"}"
                        }
                    else -> "[{\"series_id\":1,\"category_id\":1,\"name\":\"Series\",\"cover\":\"https://untrusted.example.com/secret\"}]"
                }
                return FixtureCall(payload)
            }
            override suspend fun objectResponse(url: String): Map<String, Any?> = error("Unexpected EPG")
            override suspend fun jsonResponse(url: String): JsonElement = error("Unexpected details")
        }
        val result = PlaylistManager(api, db.dao(), externalCatalog = true).syncAll(external)
        assertEquals(0, result.failedSectionCount)
        assertEquals(20003, result.freshItemCount)
        assertEquals(20001, db.dao().catalogCountAll(external.id, "movie"))
        assertNull(db.dao().stream("${external.id}:movie:20001")?.icon)
        assertEquals("mkv", db.dao().stream("${external.id}:movie:20001")?.extension)
        assertNull(db.dao().stream("${external.id}:live:1")?.directSource)
        assertNull(db.dao().stream("${external.id}:series:1")?.icon)
        assertTrue(requests.all { it.startsWith(external.baseUrl + "/player_api.php?action=") &&
            !it.contains("username=") && !it.contains("password=") })
    }

    @Test fun externalCatalogKeepsPublicProviderArtworkAfterRefresh(): Unit = runBlocking(Dispatchers.IO) {
        val external = ProviderEntity("external-artwork-fixture","External fixture",
            tv.blofy.player.data.remote.ExternalXtreamCatalogTransport.ORIGIN,"","",enabled = false)
        val host = checkNotNull(tv.blofy.player.core.identity.ExternalStreamConnectClient.parseHost("https://provider.example.com"))
        val credentials = tv.blofy.player.core.identity.ExternalStreamConnectClient.Credentials(host,"fixture-user","fixture-secret")
        val api = object : XtreamApi {
            override suspend fun list(url: String) = listOf(mapOf("category_id" to "1","category_name" to "Category"))
            override fun streamingCall(url: String): retrofit2.Call<ResponseBody> = FixtureCall(when {
                url.contains("get_live_streams") -> """[{"stream_id":1,"category_id":1,"name":"Live","stream_icon":"/logos/1.png"}]"""
                url.contains("get_vod_streams") -> """[{"stream_id":2,"category_id":1,"name":"Movie","cover_big":"https://cdn.example.net/posters/2.jpg","direct_source":"https://provider.example.com/movie/fixture-user/fixture-secret/2.mp4"}]"""
                else -> """[{"series_id":3,"category_id":1,"name":"Series","cover":"https://cdn.example.net/images/3.webp","backdrop_path":["https://cdn.example.net/backdrops/3.jpg"]}]"""
            })
            override suspend fun objectResponse(url: String): Map<String, Any?> = error("Unexpected EPG")
            override suspend fun jsonResponse(url: String): JsonElement = error("Unexpected details")
        }
        val manager = PlaylistManager(api,db.dao(),externalCatalog = true,artworkCredentials = credentials)
        repeat(2) {
            assertEquals(0,manager.syncAll(external).failedSectionCount)
            assertEquals("https://provider.example.com/logos/1.png",db.dao().stream("${external.id}:live:1")?.icon)
            assertEquals("https://cdn.example.net/posters/2.jpg",db.dao().stream("${external.id}:movie:2")?.icon)
            assertNull(db.dao().stream("${external.id}:movie:2")?.directSource)
            assertEquals("https://cdn.example.net/images/3.webp",db.dao().stream("${external.id}:series:3")?.icon)
            assertEquals("https://cdn.example.net/backdrops/3.jpg",db.dao().stream("${external.id}:series:3")?.backdrop)
        }
    }

    @Test fun interruptedExternalImportKeepsCompletedSectionsAndRebuildsOnlyMissingRows(): Unit = runBlocking(Dispatchers.IO) {
        val context = RuntimeEnvironment.getApplication()
        val external = ProviderEntity("external-" + java.util.UUID.randomUUID(), "External",
            tv.blofy.player.data.remote.ExternalXtreamCatalogTransport.ORIGIN,"","",enabled = false)
        val dao = db.dao()
        dao.upsertProvider(external)
        val first = PlaylistManager(FixtureApi(),dao,externalCatalog = true)
        first.syncLive(external)
        FirstImportCheckpoint.markCompleted(context,external,"live")
        // A partial movie batch has no completion marker. It must be removed.
        val partial = StreamEntity("${external.id}:movie:999",external.id,"999","1","movie","Partial")
        dao.insertCatalogBatch(listOf(partial),listOf(StreamSearchFtsEntity(partial.key,partial.providerId,partial.kind,partial.name)))
        try {
            val checkpoint = FirstImportCheckpoint.discardIncompleteSections(context,dao,external)
            assertEquals(setOf("live"),checkpoint.completed)
            assertEquals(1,dao.catalogCountAll(external.id,"live"))
            assertNull(dao.stream(partial.key))
            assertFalse(CatalogSyncState.isReady(context,external.id))
            // A fresh manager cannot fetch live; the validated checkpoint must skip it.
            val resumed = PlaylistManager(FixtureApi(liveCategories = emptyList(),liveStreams = "invalid"),dao,externalCatalog = true)
                .syncAll(external,completedSections = checkpoint.completed,
                    onSectionComplete = { FirstImportCheckpoint.markCompleted(context,external,it) })
            assertEquals(0,resumed.failedSectionCount)
            assertEquals(3,resumed.freshItemCount)
            assertEquals(setOf("live","movie","series"),FirstImportCheckpoint.state(context,external).completed)
            assertFalse(dao.provider(external.id)!!.enabled)
            assertFalse(CatalogSyncState.isReady(context,external.id))
            // If durable rows disappear the checkpoint cannot hide the missing section.
            dao.clearStreams(external.id,"live")
            assertEquals(setOf("movie","series"),FirstImportCheckpoint.discardIncompleteSections(context,dao,external).completed)
        } finally { FirstImportCheckpoint.clear(context,external.id) }
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
