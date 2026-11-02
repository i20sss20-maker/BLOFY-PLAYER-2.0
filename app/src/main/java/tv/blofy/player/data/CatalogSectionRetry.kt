package tv.blofy.player.data

import com.google.gson.JsonParseException
import java.io.IOException
import javax.net.ssl.SSLHandshakeException
import javax.net.ssl.SSLPeerUnverifiedException
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.ensureActive
import retrofit2.HttpException

/** Retry only the failed catalog section; never restart sections already committed to disk. */
internal object CatalogSectionRetry {
    const val MAX_ATTEMPTS = 4

    suspend fun <T> run(
        onRetry: suspend (Int) -> Unit = {},
        pause: suspend (Long) -> Unit = { delay(it) },
        block: suspend () -> T
    ): T {
        var attempt = 1
        while (true) {
            currentCoroutineContext().ensureActive()
            try {
                return block()
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (failure: Exception) {
                currentCoroutineContext().ensureActive()
                if (attempt >= MAX_ATTEMPTS || !isTransient(failure)) throw failure
                attempt += 1
                onRetry(attempt)
                // Streaming gateways sometimes sever large catalog responses during a brief
                // restart. Retry the unfinished section with growing backoff, keeping
                // completed first-import sections durable; never retry auth/SSL failures.
                pause(when (attempt) {
                    2 -> 1_000L
                    3 -> 3_000L
                    else -> 7_000L
                })
            }
        }
    }

    private fun isTransient(failure: Throwable, depth: Int = 0): Boolean {
        if (depth > 8) return false
        return when (failure) {
            is HttpException -> failure.code() in listOf(408, 429) || failure.code() in 500..599
            is SSLHandshakeException, is SSLPeerUnverifiedException -> false
            is IOException -> true // Includes interrupted/truncated response bodies and socket timeouts.
            // Gson wraps body IO failures, and coroutine stack recovery can wrap that exception
            // again. Only unwrap parser errors; never reinterpret a storage/validation failure.
            is JsonParseException -> failure.cause?.let { isTransient(it, depth + 1) } ?: false
            else -> false
        }
    }
}
