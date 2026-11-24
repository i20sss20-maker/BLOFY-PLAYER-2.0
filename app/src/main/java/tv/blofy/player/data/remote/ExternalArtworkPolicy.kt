package tv.blofy.player.data.remote

import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import tv.blofy.player.core.identity.ExternalStreamConnectVerifier
import java.util.concurrent.TimeUnit

/** Public TMDB artwork only. Never persist arbitrary provider URLs, credentials,
 * redirects or tracking query strings from an external catalog. */
internal object ExternalArtworkPolicy {
    private val path = Regex("/t/p/(?:original|w[0-9]{2,4}|h[0-9]{2,4})/[A-Za-z0-9_-]{1,120}\\.(?:jpg|jpeg|png|webp)", RegexOption.IGNORE_CASE)
    fun safeUrl(raw: String?): String? {
        val text = raw?.trim()?.takeIf { it.length in 1..512 } ?: return null
        val url = text.toHttpUrlOrNull() ?: return null
        if (url.scheme != "https" || url.host != "image.tmdb.org" || url.port != 443 ||
            url.username.isNotEmpty() || url.password.isNotEmpty() ||
            url.query != null || url.fragment != null || !path.matches(url.encodedPath)) return null
        return url.toString()
    }

    val client by lazy {
        ExternalStreamConnectVerifier.directClient.newBuilder()
            .connectTimeout(4,TimeUnit.SECONDS)
            .readTimeout(8,TimeUnit.SECONDS)
            .callTimeout(12,TimeUnit.SECONDS)
            .build()
    }
}
