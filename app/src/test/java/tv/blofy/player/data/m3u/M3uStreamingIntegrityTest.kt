package tv.blofy.player.data.m3u

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import okhttp3.Call
import okhttp3.EventListener
import okhttp3.OkHttpClient
import okhttp3.Response
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.SocketPolicy
import org.junit.Assert.*
import org.junit.Test
import tv.blofy.player.data.local.ProviderEntity
import java.io.IOException
import java.util.concurrent.TimeUnit

class M3uStreamingIntegrityTest {
    private fun provider(server: MockWebServer) = ProviderEntity(
        "stage", "M3U fixture", server.url("/playlist.m3u").toString(), "", "", providerType = "m3u"
    )
    private fun playlist(count: Int, prefix: String = "live", series: Boolean = false) = buildString {
        appendLine("#EXTM3U")
        repeat(count) { i ->
            val name = if (series) "Fixture S01E${i + 1}" else "Channel $i"
            appendLine("#EXTINF:-1 group-title=\"Fixture\",$name")
            appendLine("https://fixture.example.test/$prefix/$i.ts")
        }
    }
    private fun truncated(body: String) = MockResponse().setBody(body)
        .setHeader("Content-Length", body.toByteArray(Charsets.UTF_8).size + 1024)
        .setSocketPolicy(SocketPolicy.DISCONNECT_AT_END)

    @Test fun retryClearsRowsFromEarlierResponseBeforeAcceptingNewResponse(): Unit = runBlocking {
        val server = MockWebServer()
        server.enqueue(truncated(playlist(1_000, "old")))
        server.enqueue(MockResponse().setBody(playlist(10, "new")))
        server.start()
        try {
            val stored = mutableListOf<String>()
            var resets = 0
            var rowsDiscarded = 0
            val summary = M3uPlaylistLoader().loadStreaming(provider(server),
                onStreamBatch = { stored += it.map { row -> checkNotNull(row.directSource) } },
                onEpisodeBatch = {},
                onAttemptReset = { rowsDiscarded += stored.size; stored.clear(); resets++ },
            )
            assertEquals(1, resets)
            assertTrue("must reproduce a partially written first attempt", rowsDiscarded >= 700)
            assertEquals(10, stored.size)
            assertEquals(10, summary.streamCount)
            assertTrue(stored.all { it.contains("/new/") })
            assertEquals(2, server.requestCount)
        } finally { server.shutdown() }
    }

    @Test fun nonResettableSinkCannotMixPartialAndSuccessfulResponses(): Unit = runBlocking {
        val server = MockWebServer()
        server.enqueue(truncated(playlist(1_000)))
        server.enqueue(MockResponse().setBody(playlist(10)))
        server.start()
        try {
            var written = 0
            val failure = runCatching { M3uPlaylistLoader().loadStreaming(provider(server),
                onStreamBatch = { written += it.size }, onEpisodeBatch = {},
            ) }.exceptionOrNull()
            assertTrue(failure is IOException)
            assertTrue(written >= 700)
            assertEquals(1, server.requestCount)
        } finally { server.shutdown() }
    }

    @Test fun storageFailureDoesNotTriggerCompatibilityRetries(): Unit = runBlocking {
        val server = MockWebServer()
        repeat(3) { server.enqueue(MockResponse().setBody(playlist(1_000))) }
        server.start()
        try {
            val storageFailure = IOException("fixture storage full")
            var resets = 0
            val failure = runCatching { M3uPlaylistLoader().loadStreaming(provider(server),
                onStreamBatch = { throw storageFailure }, onEpisodeBatch = {}, onAttemptReset = { resets++ },
            ) }.exceptionOrNull()
            // withContext can copy the exception for coroutine debug stacktrace recovery.
            // Preserve the original-cause assertion rather than depending on wrapper identity.
            assertTrue(failure is IOException)
            assertEquals(storageFailure.message, failure?.message)
            assertTrue(generateSequence(failure) { it.cause }.take(8).any { it === storageFailure })
            assertEquals(0, resets)
            assertEquals(1, server.requestCount)
        } finally { server.shutdown() }
    }

    @Test fun cancellationFromConsumerIsNeverRetried(): Unit = runBlocking {
        val server = MockWebServer()
        repeat(3) { server.enqueue(MockResponse().setBody(playlist(1_000))) }
        server.start()
        try {
            val failure = runCatching { M3uPlaylistLoader().loadStreaming(provider(server),
                onStreamBatch = { throw CancellationException("fixture cancelled") },
                onEpisodeBatch = {}, onAttemptReset = {},
            ) }.exceptionOrNull()
            assertTrue(failure is CancellationException)
            assertEquals(1, server.requestCount)
        } finally { server.shutdown() }
    }

    @Test fun simpleHeaderAndDirectUrlsRemainSupported(): Unit = runBlocking {
        val server = MockWebServer()
        val url = "https://fixture.example.test/live/1.ts?token=unchanged"
        server.enqueue(MockResponse().setBody("#EXTM3U\n$url\n"))
        server.start()
        try {
            val stored = mutableListOf<String?>()
            val summary = M3uPlaylistLoader().loadStreaming(provider(server),
                onStreamBatch = { stored += it.map { row -> row.directSource } }, onEpisodeBatch = {},
            )
            assertEquals(1, summary.streamCount)
            assertEquals(listOf(url), stored)
        } finally { server.shutdown() }
    }

    @Test fun htmlAfterPlaylistHeaderIsRejectedInsteadOfBecomingAChannel(): Unit = runBlocking {
        val server = MockWebServer()
        repeat(3) { server.enqueue(MockResponse().setBody("#EXTM3U\n#EXTINF:-1,Bad\n<html>login</html>\n")) }
        server.start()
        try {
            var written = 0
            val failure = runCatching { M3uPlaylistLoader().loadStreaming(provider(server),
                onStreamBatch = { written += it.size }, onEpisodeBatch = {},
            ) }.exceptionOrNull()
            assertTrue(failure is IOException)
            assertEquals(0, written)
        } finally { server.shutdown() }
    }

    @Test fun unfinishedFinalEntryCannotBeReportedAsComplete(): Unit = runBlocking {
        val server = MockWebServer()
        server.enqueue(MockResponse().setBody(playlist(1_000) + "#EXTINF:-1,Missing URL\n"))
        server.start()
        try {
            val failure = runCatching { M3uPlaylistLoader().loadStreaming(provider(server),
                onStreamBatch = {}, onEpisodeBatch = {},
            ) }.exceptionOrNull()
            assertTrue(failure is IOException)
            assertEquals(1, server.requestCount)
        } finally { server.shutdown() }
    }

    @Test fun cancellationAfterHeadersClosesSocketBeforeReadTimeout(): Unit = runBlocking {
        val server = MockWebServer()
        server.enqueue(MockResponse().setBody(playlist(1)).setBodyDelay(3, TimeUnit.SECONDS))
        server.start()
        try {
            val headers = CompletableDeferred<Unit>()
            val client = OkHttpClient.Builder().readTimeout(20, TimeUnit.SECONDS)
                .eventListener(object : EventListener() {
                    override fun responseHeadersEnd(call: Call, response: Response) { headers.complete(Unit) }
                }).build()
            val job = launch { M3uPlaylistLoader(client).loadStreaming(provider(server), {}, {}) }
            withTimeout(2_000) { headers.await() }
            job.cancel()
            withTimeout(1_500) { job.join() }
            assertTrue(job.isCancelled)
            assertEquals(1, server.requestCount)
        } finally { server.shutdown() }
    }
}
