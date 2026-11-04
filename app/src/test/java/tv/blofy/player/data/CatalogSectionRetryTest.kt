package tv.blofy.player.data

import com.google.gson.JsonSyntaxException
import java.io.EOFException
import java.io.IOException
import javax.net.ssl.SSLHandshakeException
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.Assert.*
import org.junit.Test
import retrofit2.HttpException
import retrofit2.Response

class CatalogSectionRetryTest {
    private fun http(code: Int) = HttpException(Response.error<Unit>(code, "unavailable".toResponseBody()))

    @Test fun transientFailuresRecoverWithinTheSameAttempt() = runBlocking {
        for (error in listOf(http(503), http(429), IOException("socket closed"), JsonSyntaxException(EOFException()),
            JsonSyntaxException(JsonSyntaxException(EOFException())))) {
            var calls = 0
            val retries = mutableListOf<Int>()
            val result = CatalogSectionRetry.run(onRetry = { retries += it }, pause = {}) {
                if (++calls == 1) throw error
                "complete"
            }
            assertEquals("complete", result)
            assertEquals(2, calls)
            assertEquals(listOf(2), retries)
        }
    }

    @Test fun permanentErrorsDoNotLoopOrBecomeSuccess() = runBlocking {
        for (error in listOf(http(401), http(403), http(404), SSLHandshakeException("certificate"), IllegalStateException("incomplete catalog"))) {
            var calls = 0
            val failure = runCatching { CatalogSectionRetry.run(pause = {}) { calls++; throw error } }.exceptionOrNull()
            assertSame(error, failure)
            assertEquals(1, calls)
        }
    }

    @Test fun exhaustedTransientFailureIsReportedAfterThreeAttempts() = runBlocking {
        var calls = 0
        val waits = mutableListOf<Long>()
        val error = http(502)
        val failure = runCatching { CatalogSectionRetry.run(pause = { waits += it }) { calls++; throw error } }.exceptionOrNull()
        assertSame(error, failure)
        assertEquals(3, calls)
        assertEquals(listOf(1_000L, 3_000L), waits)
    }

    @Test fun detectsTruncatedCatalogTransportWithoutTreatingOtherErrorsAsRecoverable() {
        assertTrue(CatalogSectionRetry.isTruncatedBody(IOException("unexpected end of stream on secret URL")))
        assertTrue(CatalogSectionRetry.isTruncatedBody(JsonSyntaxException(EOFException("End of input"))))
        assertFalse(CatalogSectionRetry.isTruncatedBody(http(403)))
        assertFalse(CatalogSectionRetry.isTruncatedBody(IllegalStateException("incomplete catalog")))
        assertFalse(CatalogSectionRetry.isTruncatedBody(SSLHandshakeException("bad certificate")))
    }

    @Test fun onlyExhaustedSectionCanRecoverAndReportSuccess() = runBlocking {
        var fullAttempts = 0
        var fallbackCalls = 0
        val result = runXtreamSections(
            sections = listOf(suspend { fullAttempts++; throw EOFException("truncated response") }),
            onExhausted = { index, error ->
                assertEquals(0, index)
                assertTrue(error is EOFException)
                fallbackCalls++
                true
            }
        )
        assertEquals(CatalogSectionRetry.MAX_ATTEMPTS, fullAttempts)
        assertEquals(1, fallbackCalls)
        assertEquals(1, result.successCount)
        assertEquals(0, result.failureCount)
    }

    @Test fun cancellationDuringBackoffStopsWithoutAnotherRequest() = runBlocking {
        var calls = 0
        val failure = runCatching {
            withTimeout(100) {
                CatalogSectionRetry.run(pause = { awaitCancellation() }) { calls++; throw IOException("offline") }
            }
        }.exceptionOrNull()
        assertTrue(failure is CancellationException)
        assertEquals(1, calls)
    }
}
