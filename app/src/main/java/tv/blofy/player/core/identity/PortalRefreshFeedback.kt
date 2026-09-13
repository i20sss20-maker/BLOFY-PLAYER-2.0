package tv.blofy.player.core.identity

import android.content.Context
import kotlinx.coroutines.TimeoutCancellationException
import retrofit2.HttpException
import tv.blofy.player.R
import java.io.IOException
import java.net.SocketTimeoutException
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
        val http = safe?.httpStatus ?: (cause as? HttpException)?.code()
        val reason = when {
            cause is TimeoutCancellationException || cause is SocketTimeoutException -> R.string.portal_refresh_timeout
            cause is SSLException -> R.string.portal_refresh_tls
            cause is UnknownHostException -> R.string.portal_refresh_dns
            http == 401 || http == 403 -> R.string.portal_refresh_identity
            http == 429 -> R.string.portal_refresh_busy
            http != null -> R.string.portal_refresh_service
            safe?.stage == "DATA" -> R.string.portal_refresh_data
            safe?.stage == "AUTH" -> R.string.portal_refresh_activation
            cause is IOException -> R.string.portal_refresh_network
            else -> R.string.portal_refresh_local
        }
        val stage = safe?.stage?.takeIf { it in setOf("LIST", "SUB", "AUTH", "DATA") } ?: "LOCAL"
        return context.getString(reason) + " [P-" + stage + (http?.let { "-$it" } ?: "") + "]"
    }
}
