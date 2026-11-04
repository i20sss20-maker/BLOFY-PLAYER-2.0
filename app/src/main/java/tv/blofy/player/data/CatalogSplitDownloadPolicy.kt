package tv.blofy.player.data

import com.google.gson.JsonParseException
import java.io.EOFException
import java.io.IOException
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import retrofit2.HttpException

/**
 * Very large global Xtream JSON arrays can be truncated by a supplier.
 * Xtream also supports category_id for get_live_streams and get_series.
 * Only retry in smaller requests when the failure is compatible with a
 * broken/oversized response; do not disguise authentication failures.
 */
internal object CatalogSplitDownloadPolicy {
    fun canSplit(error: Throwable, categoryCount: Int): Boolean {
        if (categoryCount !in 1..2000) return false
        val chain = generateSequence(error) { it.cause }.take(12).toList()
        val http = chain.filterIsInstance<HttpException>().firstOrNull()?.code()
        if (http != null) return http == 404 || http == 408 || http == 429 || http in 500..599
        if (chain.any { it is UnknownHostException }) return false
        return chain.any { it is IOException || it is JsonParseException }
    }
}
