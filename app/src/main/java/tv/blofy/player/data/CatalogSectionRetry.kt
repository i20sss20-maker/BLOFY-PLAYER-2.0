package tv.blofy.player.data

import com.google.gson.JsonParseException
import java.io.EOFException
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
    const val MAX_ATTEMPTS = 3

    suspend fun <T> run(
        onRetry: suspend (Int) -> Unit = {},
        pause: suspend (Long) -> Unit = { delay(it) },
        maxTruncatedAttempts: Int = MAX_ATTEMPTS,
        block: suspend () -> T
    ): T {
        require(maxTruncatedAttempts in 1..MAX_ATTEMPTS)
        var attempt = 1
        while (true) {
            currentCoroutineContext().ensureActive()
            try {
                return block()
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (failure: Exception) {
                currentCoroutineContext().ensureActive()
                // Repeating a 100k-row truncated payload until it reaches the same EOF
                // can exhaust WorkManager's deadline and leave the UI at 64% on each retry.
                // Prefer validated per-category fallback after a bounded whole-array retry.
                if (attempt >= MAX_ATTEMPTS ||
                    (isTruncatedBody(failure) && attempt >= maxTruncatedAttempts) ||
                    !isTransient(failure)) throw failure
                attempt += 1
                onRetry(attempt)
                pause(if (attempt == 2) 1_000L else 3_000L)
            }
        }
    }

    /** A large Xtream JSON response ended before its closing bytes arrived. After ordinary
     * whole-section retries are exhausted, the caller can safely try smaller category reads.
     * Never fall back on auth errors, TLS failures, invalid JSON shapes or SQLite failures.
     */
    internal fun isTruncatedBody(failure: Throwable, depth: Int = 0): Boolean {
        if (depth > 8) return false
        if (failure is SSLHandshakeException || failure is SSLPeerUnverifiedException) return false
        if (failure is EOFException) return true
        if (failure is IOException) {
            val text = failure.message.orEmpty().lowercase()
            if ("unexpected end of stream" in text || "unexpected end of input" in text ||
                "premature end" in text || "stream was reset" in text) return true
        }
        return failure.cause?.takeIf { it !== failure }?.let { isTruncatedBody(it, depth + 1) } ?: false
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
