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
    const val MAX_ATTEMPTS = 3

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
                pause(if (attempt == 2) 1_000L else 3_000L)
            }
        }
    }

    private fun isTransient(failure: Exception): Boolean = when (failure) {
        is HttpException -> failure.code() in listOf(408, 429) || failure.code() in 500..599
        is SSLHandshakeException, is SSLPeerUnverifiedException -> false
        is IOException -> true // Includes interrupted/truncated response bodies and socket timeouts.
        is JsonParseException -> (failure.cause as? IOException)?.let(::isTransient) ?: false
        else -> false // Storage, credentials, invalid catalogs and source-change guards stay failures.
    }
}
