package tv.blofy.player.data

import androidx.room.Room
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking
import okhttp3.mockwebserver.Dispatcher
import okhttp3.ResponseBody.Companion.toResponseBody
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import okio.Buffer
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import retrofit2.HttpException
import retrofit2.Response
import tv.blofy.player.data.local.BlofyDatabase
import tv.blofy.player.data.local.ProviderEntity
import tv.blofy.player.data.remote.XtreamClient
import java.io.ByteArrayOutputStream
import java.io.EOFException
import java.util.concurrent.ConcurrentHashMap
import java.util.zip.GZIPOutputStream

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28], application = tv.blofy.player.data.local.InMemoryKeystoreApplication::class)
class XtreamCatalogTransportTest {
    private lateinit var database: BlofyDatabase

    @Before fun setup() {
        database = Room.inMemoryDatabaseBuilder(
            RuntimeEnvironment.getApplication(), BlofyDatabase::class.java
        ).build()
    }

    @After fun teardown() { database.close() }

    private fun compress(content: String): Buffer {
        val result = ByteArrayOutputStream()
        GZIPOutputStream(result).use { it.write(content.toByteArray(Charsets.UTF_8)) }
        return Buffer().write(result.toByteArray())
    }

    @Test fun fullCatalogStreamsThroughTransparentGzip(): Unit = runBlocking(Dispatchers.IO) {
        MockWebServer().use { server ->
            val encodings = mutableListOf<String>()
            server.dispatcher = object : Dispatcher() {
                override fun dispatch(req: RecordedRequest): MockResponse {
                    val action = req.requestUrl?.queryParameter("action").orEmpty()
                    synchronized(encodings) { encodings += req.getHeader("Accept-Encoding").orEmpty() }
                    val data = when (action) {
                        "get_live_categories", "get_vod_categories", "get_series_categories" ->
                            """[{"category_id":"1","category_name":"One"}]"""
                        "get_live_streams" -> """[{"stream_id":1,"category_id":"1","name":"Live"}]"""
                        "get_vod_streams" -> """[{"stream_id":2,"category_id":"1","name":"Movie"}]"""
                        "get_series" -> """[{"series_id":3,"category_id":"1","name":"Series"}]"""
                        else -> "[]"
                    }
                    return MockResponse().setHeader("Content-Encoding", "gzip").setBody(compress(data))
                }
            }
            server.start()
            val provider = ProviderEntity("gzip-provider", "BLOFY", server.url("/").toString(), "u", "p")
            val result = PlaylistManager(XtreamClient.api, database.dao()).syncAll(provider)
            assertEquals(0, result.failedSectionCount)
            assertEquals(3, result.freshItemCount)
            assertTrue(encodings.isNotEmpty())
            assertTrue(encodings.all { it == "gzip" })
        }
    }

    @Test fun truncatedCompressedStreamsRecoverOnceWithIdentity(): Unit = runBlocking(Dispatchers.IO) {
        MockWebServer().use { server ->
            val seen = ConcurrentHashMap<String, MutableList<String>>()
            server.dispatcher = object : Dispatcher() {
                override fun dispatch(req: RecordedRequest): MockResponse {
                    val action = req.requestUrl?.queryParameter("action").orEmpty()
                    val encoding = req.getHeader("Accept-Encoding").orEmpty()
                    seen.computeIfAbsent(action) { java.util.Collections.synchronizedList(mutableListOf()) }.add(encoding)
                    val data = when (action) {
                        "get_live_categories", "get_vod_categories", "get_series_categories" ->
                            """[{"category_id":"1","category_name":"One"}]"""
                        "get_live_streams" -> """[{"stream_id":1,"category_id":"1","name":"Live"}]"""
                        "get_vod_streams" -> """[{"stream_id":2,"category_id":"1","name":"Movie"}]"""
                        "get_series" -> """[{"series_id":3,"category_id":"1","name":"Series"}]"""
                        else -> "[]"
                    }
                    val body = if (encoding == "identity" || action.endsWith("categories")) data
                        else data.dropLast(3)
                    return if (encoding == "gzip") {
                        MockResponse().setHeader("Content-Encoding", "gzip").setBody(compress(body))
                    } else MockResponse().setBody(body)
                }
            }
            server.start()
            val provider = ProviderEntity("encoding-provider", "BLOFY", server.url("/").toString(), "u", "p")
            val result = PlaylistManager(XtreamClient.api, database.dao()).syncAll(provider)
            assertEquals(0, result.failedSectionCount)
            assertEquals(3, result.freshItemCount)
            listOf("get_live_streams", "get_vod_streams", "get_series").forEach { action ->
                assertEquals(listOf("gzip", "identity"), seen[action])
            }
            assertEquals(3, database.dao().streamCountForProvider(provider.id))
        }
    }

    @Test fun truncatedCategoriesRecoverWithIdentityBeforeLoadingStreams(): Unit = runBlocking(Dispatchers.IO) {
        MockWebServer().use { server ->
            val seen = ConcurrentHashMap<String, MutableList<String>>()
            server.dispatcher = object : Dispatcher() {
                override fun dispatch(req: RecordedRequest): MockResponse {
                    val action = req.requestUrl?.queryParameter("action").orEmpty()
                    val encoding = req.getHeader("Accept-Encoding").orEmpty()
                    seen.computeIfAbsent(action) { java.util.Collections.synchronizedList(mutableListOf()) }.add(encoding)
                    val data = when {
                        action.endsWith("categories") -> """[{"category_id":"1","category_name":"One"}]"""
                        action == "get_series" -> """[{"series_id":3,"category_id":"1","name":"Series"}]"""
                        else -> """[{"stream_id":1,"category_id":"1","name":"Item"}]"""
                    }
                    val body = if (action.endsWith("categories") && encoding != "identity") data.dropLast(4) else data
                    return if (encoding == "gzip") MockResponse().setHeader("Content-Encoding", "gzip").setBody(compress(body))
                        else MockResponse().setBody(body)
                }
            }
            server.start()
            val provider = ProviderEntity("category-encoding", "BLOFY", server.url("/").toString(), "u", "p")
            val result = PlaylistManager(XtreamClient.api, database.dao()).syncAll(provider)
            assertEquals(0, result.failedSectionCount)
            assertEquals(3, result.freshItemCount)
            listOf("get_live_categories", "get_vod_categories", "get_series_categories").forEach {
                assertEquals(listOf("gzip", "identity"), seen[it])
            }
        }
    }

    @Test fun legacyGsonCompatibleCatalogPrefixDoesNotBlockEntry(): Unit = runBlocking(Dispatchers.IO) {
        MockWebServer().use { server ->
            server.dispatcher = object : Dispatcher() {
                override fun dispatch(req: RecordedRequest): MockResponse {
                    val action = req.requestUrl?.queryParameter("action").orEmpty()
                    val data = when {
                        action.endsWith("categories") -> """[{"category_id":"1","category_name":"One"}]"""
                        action == "get_series" -> """[{"series_id":3,"category_id":"1","name":"Series"}]"""
                        else -> """[{"stream_id":1,"category_id":"1","name":"Item"}]"""
                    }
                    return MockResponse().setBody(")]}'\n" + data)
                }
            }
            server.start()
            val provider = ProviderEntity("legacy-prefix", "BLOFY", server.url("/").toString(), "u", "p")
            val result = PlaylistManager(XtreamClient.api, database.dao()).syncAll(provider)
            assertEquals(0, result.failedSectionCount)
            assertEquals(3, result.freshItemCount)
        }
    }

    @Test fun doNotReinterpretDnsTlsOrAuthorizationAsEncodingProblem() {
        assertFalse(CatalogTransportFallbackPolicy.shouldTryIdentity(java.net.UnknownHostException("host")))
        assertFalse(CatalogTransportFallbackPolicy.shouldTryIdentity(
            HttpException(Response.error<Unit>(401, "bad".toResponseBody()))
        ))
        assertTrue(CatalogTransportFallbackPolicy.shouldTryIdentity(EOFException("end of stream")))
    }
}
