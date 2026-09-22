package tv.blofy.player.core.update

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.runBlocking
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File
import java.io.IOException

class UpdateDownloadTest {
    @get:Rule val files = TemporaryFolder()
    private val client = OkHttpClient()

    private fun receive(reply: MockResponse, file: File, start: Long = file.length(), max: Long = 1024L) = runBlocking {
        MockWebServer().use { server ->
            server.enqueue(reply)
            server.start()
            client.newCall(Request.Builder().url(server.url("/update.apk")).build()).execute().use {
                UpdateDownload.receive(it, file, start, max)
            }
        }
    }

    @Test fun acceptsChunkedDownloadsWithoutContentLength() {
        val file = files.newFile()
        receive(MockResponse().setChunkedBody("complete signed package bytes", 3), file)
        assertEquals("complete signed package bytes", file.readText())
    }

    @Test fun transientHttpFailurePreservesThePrefixForTheNextAttempt() {
        val file = files.newFile().apply { writeText("ABC") }
        assertThrows(IOException::class.java) { receive(MockResponse().setResponseCode(503), file) }
        assertEquals("ABC", file.readText())
        receive(MockResponse().setResponseCode(206).setHeader("Content-Range", "bytes 3-5/6").setBody("DEF"), file)
        assertEquals("ABCDEF", file.readText())
    }

    @Test fun serverIgnoringRangeReplacesInsteadOfAppendingTheNewRepresentation() {
        val file = files.newFile().apply { writeText("OLD") }
        receive(MockResponse().setBody("NEW PACKAGE"), file)
        assertEquals("NEW PACKAGE", file.readText())
    }

    @Test fun rejectsMissingMismatchedAndMalformedRangesBeforeChangingThePrefix() {
        for (header in listOf(null, "bytes 0-2/6", "bytes 3-5/5", "bytes 3-7/8", "bytes 3-5/999999999999999999999999", "garbage")) {
            val file = files.newFile().apply { writeText("ABC") }
            val response = MockResponse().setResponseCode(206).setBody("DEF")
            header?.let { response.setHeader("Content-Range", it) }
            assertThrows(UpdateDownload.RestartRequired::class.java) { receive(response, file) }
            assertEquals("ABC", file.readText())
        }
    }

    @Test fun shorterRangeResponseKeepsItsValidatedPrefixUntilTheRemainingBytesArrive() {
        val file = files.newFile().apply { writeText("ABC") }
        assertThrows(IOException::class.java) {
            receive(MockResponse().setResponseCode(206).setHeader("Content-Range", "bytes 3-5/9").setBody("DEF"), file)
        }
        assertEquals("ABCDEF", file.readText())
        receive(MockResponse().setResponseCode(206).setHeader("Content-Range", "bytes 6-8/9").setChunkedBody("GHI", 1), file)
        assertEquals("ABCDEFGHI", file.readText())
    }

    @Test fun enforcesSizeLimitEvenForAnUnknownLengthResponse() {
        val file = files.newFile()
        assertThrows(UpdateDownload.RestartRequired::class.java) {
            receive(MockResponse().setChunkedBody("too large", 2), file, max = 4)
        }
        assertTrue(file.length() <= 4L)
    }

    @Test fun cancellationDoesNotDeletePreviouslySavedBytes(): Unit = runBlocking {
        val file = files.newFile().apply { writeText("ABC") }
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setResponseCode(206).setHeader("Content-Range", "bytes 3-5/6").setBody("DEF"))
            server.start()
            client.newCall(Request.Builder().url(server.url("/update.apk")).build()).execute().use { response ->
                try {
                    UpdateDownload.receive(response, file, 3) { _, _ -> throw CancellationException("worker stopped") }
                    fail("Cancellation must propagate")
                } catch (_: CancellationException) { }
            }
        }
        assertEquals("ABCDEF", file.readText())
    }
}
