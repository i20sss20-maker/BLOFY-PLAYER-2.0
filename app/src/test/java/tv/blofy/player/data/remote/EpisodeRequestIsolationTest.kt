package tv.blofy.player.data.remote

import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import okhttp3.Call
import okhttp3.Callback
import okhttp3.Dispatcher
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.SocketPolicy
import okio.Buffer
import okio.GzipSink
import okio.buffer
import org.junit.Assert.*
import org.junit.Test
import java.io.IOException
import java.util.concurrent.TimeUnit

class EpisodeRequestIsolationTest {
    @Test fun foregroundEpisodesDoNotWaitForSaturatedCatalogQueue() = runBlocking {
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setSocketPolicy(SocketPolicy.NO_RESPONSE))
            server.enqueue(MockResponse().setBody("{\"episodes\":{\"1\":[]}}"))
            server.start()
            val dispatcher = Dispatcher().apply { maxRequests = 1; maxRequestsPerHost = 1 }
            val bulk = OkHttpClient.Builder().dispatcher(dispatcher).build()
            val stalled = bulk.newCall(Request.Builder().url(server.url("/bulk")).build())
            stalled.enqueue(object : Callback {
                override fun onFailure(call: Call, e: IOException) = Unit
                override fun onResponse(call: Call, response: Response) = response.close()
            })
            assertNotNull(server.takeRequest(2, TimeUnit.SECONDS))
            try {
                val episode = XtreamClient.episodeClient(bulk)
                assertNotSame(bulk.dispatcher, episode.dispatcher)
                val response = withTimeout(3_000) { XtreamClient.createApi(episode).jsonResponse(server.url("/player_api.php?action=get_series_info").toString()) }
                assertTrue(response.asJsonObject.has("episodes"))
            } finally { stalled.cancel() }
        }
    }

    @Test fun gzipEpisodesAndNonstandard884StillParse() = runBlocking {
        MockWebServer().use { server ->
            val compressed = Buffer()
            GzipSink(compressed).buffer().use { it.writeUtf8("{\"episodes\":{\"1\":[]}}") }
            server.enqueue(MockResponse().setResponseCode(884).setHeader("Content-Encoding", "gzip").setBody(compressed))
            server.start()
            val response = XtreamClient.episodeApi.jsonResponse(server.url("/player_api.php?action=get_series_info").toString())
            assertTrue(response.asJsonObject.has("episodes"))
            assertEquals("gzip", server.takeRequest().getHeader("Accept-Encoding"))
        }
    }

    @Test fun stalledEpisodeBodyHasTotalDeadlineAndCanBeRetried() = runBlocking {
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setBody("{\"episodes\":{}}").setBodyDelay(2, TimeUnit.SECONDS))
            server.enqueue(MockResponse().setBody("{\"episodes\":{}}"))
            server.start()
            val configured = XtreamClient.episodeClient()
            assertEquals(25_000, configured.callTimeoutMillis)
            assertEquals(12_000, configured.readTimeoutMillis)
            val shortDeadline = configured.newBuilder().callTimeout(250, TimeUnit.MILLISECONDS).retryOnConnectionFailure(false).build()
            val url = server.url("/player_api.php?action=get_series_info").toString()
            try {
                XtreamClient.createApi(shortDeadline).jsonResponse(url)
                fail("Expected bounded timeout")
            } catch (expected: IOException) { /* canceled call releases the connection */ }
            assertTrue(XtreamClient.episodeApi.jsonResponse(url).asJsonObject.has("episodes"))
        }
    }
}
