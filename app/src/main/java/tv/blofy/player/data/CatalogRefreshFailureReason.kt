package tv.blofy.player.data

import com.google.gson.JsonParseException
import java.io.IOException
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import javax.net.ssl.SSLException
import retrofit2.HttpException

/** Stable, privacy-safe failure categories for catalog refresh. Never show URLs or credentials. */
internal object CatalogRefreshFailureReason {
    fun code(failure: Throwable): String {
        var current: Throwable? = failure
        repeat(8) {
            val error = current ?: return "LOCAL"
            when (error) {
                is HttpException -> return when (error.code()) {
                    401, 403 -> "AUTH"
                    404 -> "SOURCE_NOT_FOUND"
                    408 -> "TIMEOUT"
                    429 -> "RATE_LIMIT"
                    in 500..599 -> "SERVER"
                    else -> "BAD_RESPONSE"
                }
                is SocketTimeoutException -> return "TIMEOUT"
                is UnknownHostException -> return "DNS"
                is SSLException -> return "TLS"
                is JsonParseException -> {
                    current = error.cause
                    if (current == null || current === error) return "BAD_RESPONSE"
                    return@repeat
                }
                is IllegalStateException -> return when {
                    error.message.orEmpty().contains("category filter", ignoreCase = true) -> "FILTER_UNSUPPORTED"
                    error.message.orEmpty().contains("incomplete", ignoreCase = true) -> "INCOMPLETE"
                    else -> "LOCAL"
                }
                is IOException -> return "NETWORK"
                else -> {
                    current = error.cause
                    if (current == null || current === error) return "LOCAL"
                }
            }
        }
        return "LOCAL"
    }
}
