package tv.blofy.player.core.network

import android.app.Application
import androidx.annotation.OptIn
import androidx.media3.common.PlaybackException
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DataSpec
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.datasource.HttpDataSource
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.lang.reflect.Proxy

@OptIn(markerClass = [UnstableApi::class])
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28], application = Application::class)
class HttpOpenFallbackTest {
    private fun failedFactory(error: (DataSpec) -> Exception, events: MutableList<String>) = object : HttpDataSource.Factory {
        override fun setDefaultRequestProperties(properties: Map<String, String>) = this
        override fun createDataSource() = Proxy.newProxyInstance(HttpDataSource::class.java.classLoader,
            arrayOf(HttpDataSource::class.java)) { _, method, args ->
            when (method.name) {
                "open" -> { events += "primary-open"; throw error(args!![0] as DataSpec) }
                "close" -> { events += "primary-close"; Unit }
                else -> null
            }
        } as HttpDataSource
    }

    @Test fun failedConnectionClosesBeforeHttpAndPreservesRangeAndHeaders() {
        val events = mutableListOf<String>()
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setResponseCode(206).setHeader("Content-Range", "bytes 4-7/8").setBody("data"))
            server.start()
            val primary = failedFactory({ spec -> HttpDataSource.HttpDataSourceException("connect", spec,
                PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_FAILED, HttpDataSource.HttpDataSourceException.TYPE_OPEN) }, events)
            val http = DefaultHttpDataSource.Factory()
            val fallback = object : HttpDataSource.Factory by http {
                override fun createDataSource(): HttpDataSource {
                    val source = http.createDataSource()
                    return object : HttpDataSource by source {
                        override fun open(dataSpec: DataSpec): Long {
                            assertEquals(listOf("primary-open", "primary-close"), events)
                            return source.open(dataSpec)
                        }
                    }
                }
            }
            val source = HttpOpenFallbackFactory(primary, fallback).createDataSource()
            source.setRequestProperty("X-Test", "kept")
            val spec = DataSpec.Builder().setUri(server.url("/series/u/p/1.mkv").toString()).setPosition(4).setLength(4).build()
            try {
                assertEquals(4L, source.open(spec))
                val bytes = ByteArray(4)
                assertEquals(4, source.read(bytes, 0, bytes.size))
                assertEquals("data", String(bytes))
                assertEquals(206, source.responseCode)
                val request = server.takeRequest()
                assertEquals("bytes=4-7", request.getHeader("Range"))
                assertEquals("kept", request.getHeader("X-Test"))
            } finally { source.close() }
        }
    }

    @Test fun serverRefusalIsNotRetriedWithAnotherConnection() {
        val events = mutableListOf<String>()
        val primary = failedFactory({ spec -> HttpDataSource.InvalidResponseCodeException(
            458, "Refused", null, emptyMap(), spec, byteArrayOf()) }, events)
        val forbidden = object : HttpDataSource.Factory {
            override fun setDefaultRequestProperties(properties: Map<String, String>) = this
            override fun createDataSource() = Proxy.newProxyInstance(HttpDataSource::class.java.classLoader,
                arrayOf(HttpDataSource::class.java)) { _, method, _ ->
                if (method.name == "open") fail("Must not bypass an upstream refusal")
                null
            } as HttpDataSource
        }
        val source = HttpOpenFallbackFactory(primary, forbidden).createDataSource()
        try {
            source.open(DataSpec.Builder().setUri("https://example.test/live/u/p/1.ts").build())
            fail("Expected HTTP refusal")
        } catch (expected: HttpDataSource.InvalidResponseCodeException) {
            assertEquals(458, expected.responseCode)
        } finally { source.close() }
    }
}
