package tv.blofy.player.core.identity

import java.io.IOException
import java.net.ConnectException
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import javax.net.ssl.SSLException
import retrofit2.HttpException

/**
 * Stable, non-sensitive support codes for automatic TV pairing.
 * Error details, URLs, activation codes and provider credentials must never reach the UI.
 */
internal object ActivationConnectionDiagnostics {
    enum class Stage { VERIFICATION, PLAYLIST_SYNC }

    enum class Issue(val code: String) {
        DNS("E-A01"),
        TLS("E-A02"),
        TIMEOUT("E-A03"),
        NETWORK("E-A04"),
        SERVER("E-A05"),
        RATE_LIMIT("E-A06"),
        REJECTED("E-A07"),
        PLAYLIST("E-P01"),
        UNKNOWN("E-A99")
    }

    fun classify(error: Throwable, stage: Stage): Issue {
        if (stage == Stage.PLAYLIST_SYNC) return Issue.PLAYLIST
        var cursor: Throwable? = error
        repeat(8) {
            val cause = cursor ?: return Issue.UNKNOWN
            when (cause) {
                is UnknownHostException -> return Issue.DNS
                is SSLException -> return Issue.TLS
                is SocketTimeoutException -> return Issue.TIMEOUT
                is ConnectException -> return Issue.NETWORK
                is HttpException -> return when (cause.code()) {
                    429 -> Issue.RATE_LIMIT
                    401, 403, 404, 410 -> Issue.REJECTED
                    408, 500, 502, 503, 504 -> Issue.SERVER
                    else -> Issue.UNKNOWN
                }
                is IOException -> return Issue.NETWORK
            }
            cursor = cause.cause
        }
        return Issue.UNKNOWN
    }

    /** Time-bounded retries, with a longer pause after rate limiting. */
    fun retryDelayMs(consecutiveFailures: Int, issue: Issue?): Long = when {
        issue == Issue.RATE_LIMIT -> 60_000L
        consecutiveFailures <= 1 -> 8_000L
        consecutiveFailures == 2 -> 14_000L
        else -> 25_000L
    }
}
