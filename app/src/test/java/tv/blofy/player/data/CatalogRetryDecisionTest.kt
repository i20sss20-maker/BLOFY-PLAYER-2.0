package tv.blofy.player.data

import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.Assert.*
import org.junit.Test
import retrofit2.HttpException
import retrofit2.Response
import java.io.IOException

class CatalogRetryDecisionTest {
    private fun http(code: Int) = HttpException(Response.error<Unit>(code, "unavailable".toResponseBody()))

    @Test fun permanentMissingSectionDoesNotRetryForever() {
        val missing = listOf(XtreamSectionIssue.from(0, http(404)))
        assertFalse(CatalogRetryDecision.shouldRetry(missing, 0))
        assertFalse(CatalogRetryDecision.shouldRetry(http(404), 0))
    }

    @Test fun transientSectionsHaveThreeBoundedWorkAttempts() {
        val busy = listOf(XtreamSectionIssue.from(1, http(503)))
        assertTrue(CatalogRetryDecision.shouldRetry(busy, 0))
        assertTrue(CatalogRetryDecision.shouldRetry(busy, 1))
        assertFalse(CatalogRetryDecision.shouldRetry(busy, 2))
        assertTrue(CatalogRetryDecision.shouldRetry(IOException("socket closed"), 0))
        assertFalse(CatalogRetryDecision.shouldRetry(IOException("socket closed"), 2))
    }

    @Test fun authenticationFailureStopsAtFirstAttempt() {
        assertFalse(CatalogRetryDecision.shouldRetry(
            listOf(XtreamSectionIssue.from(2, http(401))), 0
        ))
    }
}
