package tv.blofy.player.core.identity

import java.io.IOException
import java.net.ProtocolException
import javax.net.ssl.SSLException
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.ensureActive
import retrofit2.HttpException

/** Retry only transient verification failures. Never fabricate or extend an entitlement. */
internal class RetryingActivationApi(
    private val delegate: ActivationApi,
    private val backoff: suspend () -> Unit = { delay(350L) }
) : ActivationApi by delegate {
    override suspend fun check(request: ActivationCheckRequest): ActivationCheckResponse {
        try {
            return delegate.check(request)
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (error: Exception) {
            currentCoroutineContext().ensureActive()
            if (!transient(error)) throw error
        }
        backoff()
        currentCoroutineContext().ensureActive()
        // A second failure is returned unchanged. No unbounded retry, no status fallback,
        // and no automatic retry of the separate activation-code rotation operation.
        return delegate.check(request)
    }

    private fun transient(error: Exception): Boolean = when (error) {
        is SSLException, is ProtocolException -> false
        is IOException -> true
        is HttpException -> error.code() in setOf(408, 500, 502, 503, 504)
        else -> false
    }
}
