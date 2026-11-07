package tv.blofy.player.core.identity

import android.content.Context
import android.util.Log
import kotlinx.coroutines.TimeoutCancellationException
import retrofit2.HttpException
import tv.blofy.player.R
import java.io.IOException
import java.net.SocketTimeoutException
import java.net.ConnectException
import java.net.NoRouteToHostException
import java.net.ProtocolException
import java.io.EOFException
import java.net.UnknownHostException
import javax.net.ssl.SSLException

/** Never expose request bodies, PINs, tokens, URLs or raw exception messages. */
internal class PortalRefreshFailure(
    val stage: String, val httpStatus: Int? = null, cause: Throwable? = null
) : Exception("portal_$stage", cause)

internal object PortalRefreshFeedback {
    fun result(context: Context, value: PortalPlaylistClient.SyncResult): String = when {
        value.deferredCount > 0 && value.remoteCount == 0 ->
            context.getString(R.string.portal_refresh_deferred, value.deferredCount)
        value.deferredCount > 0 ->
            context.getString(R.string.portal_refresh_partial, value.remoteCount, value.deferredCount)
        else -> context.getString(R.string.portal_refresh_complete, value.remoteCount)
    }
    fun failure(context: Context, error: Throwable): String {
        val safe = error as? PortalRefreshFailure
        val cause = safe?.cause ?: error
        // Retrofit/OkHttp can wrap a concrete transport failure. Inspect only
        // exception classes; never show messages, tokens, full URLs or request bodies.
        val chain = generateSequence(cause) { current -> current.cause?.takeUnless { it === current } }
            .take(8).toList()
        val http = safe?.httpStatus ?: chain.filterIsInstance<HttpException>().firstOrNull()?.code()
        val detail = when {
            chain.any { it is UnknownHostException } -> "DNS"
            chain.any { it is SSLException } -> "TLS"
            chain.any { it is TimeoutCancellationException || it is SocketTimeoutException } -> "TIMEOUT"
            http != null -> http.toString()
            chain.any { it is ConnectException || it is NoRouteToHostException } -> "CONNECT"
            chain.any { it is ProtocolException || it is EOFException } -> "PROTOCOL"
            chain.any { it is IOException } -> "NETWORK"
            else -> "LOCAL"
        }
        val stage = safe?.stage?.takeIf { it in setOf("LIST", "SUB", "AUTH", "DATA") } ?: "LOCAL"
        Log.w("BlofyPortal", "Refresh stage=$stage category=$detail cause=${cause.javaClass.simpleName}")
        val reason = when {
            detail == "TIMEOUT" -> R.string.portal_refresh_timeout
            detail == "TLS" -> R.string.portal_refresh_tls
            detail == "DNS" -> R.string.portal_refresh_dns
            http == 401 || http == 403 -> R.string.portal_refresh_identity
            http == 429 -> R.string.portal_refresh_busy
            http != null -> R.string.portal_refresh_service
            safe?.stage == "DATA" -> R.string.portal_refresh_data
            detail in setOf("NETWORK", "CONNECT", "PROTOCOL") -> R.string.portal_refresh_network
            safe?.stage == "AUTH" -> R.string.portal_refresh_activation
            else -> R.string.portal_refresh_local
        }
        // Show a stable, useful category *on screen* because Android TV users
        // cannot access Logcat. Keep old HTTP codes intact for support/testing.
        return context.getString(reason) + " [P-" + stage + "-" + detail + "]"
    }
}
