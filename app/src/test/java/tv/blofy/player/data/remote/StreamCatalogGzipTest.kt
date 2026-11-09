package tv.blofy.player.data.remote

import kotlinx.coroutines.runBlocking
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okio.Buffer
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import tv.blofy.player.BuildConfig
import java.io.ByteArrayOutputStream
import java.util.zip.GZIPOutputStream

/**
 * Regression: STREAM's first catalog used to force Accept-Encoding: identity,
 * even though its first-party gateway explicitly supports streaming gzip.
 * Verifies OkHttp transparent decompression for both Retrofit JSON and raw
 * streaming bodies; prevents a compressed JSON response from breaking Gson.
 */
class StreamCatalogGzipTest {
    private fun compressed(content: String): Buffer {
        val output = ByteArrayOutputStream()
        GZIPOutputStream(output).use { it.write(content.toByteArray(Charsets.UTF_8)) }
        return Buffer().write(output.toByteArray())
    }

    @Test fun streamBulkCatalogAdvertisesGzipAndReadsRawStreamingArray() = runBlocking {
        assertTrue(BuildConfig.CODE_ONLY_LOGIN)
        val json = "[{\"stream_id\":123,\"name\":\"BLOFY test\"}]"
        val server = MockWebServer()
        server.start()
        try {
            server.enqueue(MockResponse().setResponseCode(200)
                .addHeader("Content-Encoding", "gzip")
                .addHeader("Content-Type", "application/json")
                .setBody(compressed(json)))
            val body = XtreamClient.api
                .streamingCall(server.url("/player_api.php?action=get_vod_streams").toString())
                .readCatalog { String(it.bytes(), Charsets.UTF_8) }
            assertEquals(json, body)
            assertEquals("gzip", server.takeRequest().getHeader("Accept-Encoding"))
        } finally {
            server.shutdown()
        }
    }

    @Test fun streamCatalogRetrofitParserCanReadCompressedCategoryList() = runBlocking {
        assertTrue(BuildConfig.CODE_ONLY_LOGIN)
        val server = MockWebServer()
        server.start()
        try {
            server.enqueue(MockResponse().setResponseCode(200)
                .addHeader("Content-Encoding", "gzip")
                .setBody(compressed("[{\"category_id\":5,\"category_name\":\"Movies\"}]")))
            val result = XtreamClient.api.list(
                server.url("/player_api.php?action=get_vod_categories").toString())
            assertEquals(1, result.size)
            assertEquals("gzip", server.takeRequest().getHeader("Accept-Encoding"))
        } finally {
            server.shutdown()
        }
    }
}
