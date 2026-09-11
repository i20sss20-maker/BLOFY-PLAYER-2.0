package tv.blofy.player.data.remote

import java.util.concurrent.TimeUnit
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.Assert.*
import org.junit.Test

class CatalogResponseTest {
    @Test fun cancelAfterHeadersClosesStalledBodyAndNextRequestWorks() = runBlocking {
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setBody("[{}]").setBodyDelay(4, TimeUnit.SECONDS))
            server.enqueue(MockResponse().setBody("[]"))
            server.start()
            val client = OkHttpClient.Builder().readTimeout(90, TimeUnit.SECONDS).build()
            val api = XtreamClient.createApi(client)
            val call = api.streamingCall(server.url("/stalled").toString())
            val reading = CompletableDeferred<Unit>()
            val download = launch(Dispatchers.IO) {
                call.readCatalog { body ->
                    reading.complete(Unit)
                    body.string()
                }
            }
            withTimeout(3_000) { reading.await() }
            withTimeout(1_000) { download.cancelAndJoin() }
            assertTrue(call.isCanceled)
            assertEquals("[]", withTimeout(3_000) {
                api.streamingCall(server.url("/retry").toString()).readCatalog { it.string() }
            })
            client.dispatcher.executorService.shutdown()
            client.connectionPool.evictAll()
        }
    }

    @Test fun httpFailureDoesNotReachTheCatalogParser() = runBlocking {
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setResponseCode(503).setBody("unavailable"))
            server.start()
            val call = XtreamClient.createApi(OkHttpClient()).streamingCall(server.url("/").toString())
            var parsed = false
            val error = runCatching { call.readCatalog { parsed = true } }.exceptionOrNull()
            assertTrue(error is retrofit2.HttpException)
            assertFalse(parsed)
            assertTrue(call.isCanceled)
        }
    }
}
