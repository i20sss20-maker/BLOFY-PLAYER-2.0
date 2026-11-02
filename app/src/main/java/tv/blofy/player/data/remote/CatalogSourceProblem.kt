package tv.blofy.player.data.remote

import java.net.URI
import java.net.UnknownHostException

/**
 * Distinguishes an unavailable playlist DNS name from transient stream disconnects.
 *
 * Do not rewrite the URL or proxy it to another server: a provider's source identity
 * is selected by the customer and can only be replaced through the approved flow.
 */
internal object CatalogSourceProblem {
    fun unresolvableHost(error: Throwable, sourceUrl: String): String? {
        var cause: Throwable? = error
        repeat(8) {
            if (cause is UnknownHostException) {
                return runCatching { URI(sourceUrl).host?.takeIf { it.isNotBlank() } }.getOrNull()
            }
            cause = cause?.cause
        }
        return null
    }
}
