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
        for (error in listOf(http(503), http(429), IOException("socket closed"), JsonSyntaxException(EOFException()))) {
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
