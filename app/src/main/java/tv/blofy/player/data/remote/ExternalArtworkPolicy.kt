package tv.blofy.player.data.remote

import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import tv.blofy.player.core.identity.ExternalStreamConnectVerifier
import tv.blofy.player.core.identity.ExternalStreamConnectClient
import java.io.IOException
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

    // Provider artwork may be on a separate public image CDN or a relative
    // image path. Do not persist credential-bearing or signed query URLs.
    private val imagePath = Regex(".*\\.(?:jpe?g|png|webp|gif|avif|bmp)$", RegexOption.IGNORE_CASE)
    private val imageDirectory = setOf("image","images","poster","posters","cover","covers","logo","logos","backdrop","backdrops","artwork","uploads")
    private val forbidden = setOf("live","movie","series","timeshift","get.php","player_api.php","xmltv.php")
    private val resize = setOf("w","h","width","height","quality","q")
    internal fun publicImageUrl(raw: String?, credentials: ExternalStreamConnectClient.Credentials? = null): String? {
        val text = raw?.trim()?.takeIf { it.length in 1..2048 && it.none { c -> c.code < 32 || c.code == 127 } } ?: return null
        val url = text.toHttpUrlOrNull() ?: credentials?.host?.resolve(text) ?: return null
        if (url.username.isNotEmpty() || url.password.isNotEmpty() || url.fragment != null) return null
        if (ExternalStreamConnectClient.parseHost(url.newBuilder().encodedPath("/").query(null).build().toString()) == null) return null
        val parts = url.pathSegments
        if (parts.any { it.lowercase() in forbidden || it.contains('/') || it.contains('\\') }) return null
        if (credentials != null && parts.any { it == credentials.username || it == credentials.password ||
                (credentials.username.length >= 6 && it.contains(credentials.username)) ||
                (credentials.password.length >= 6 && it.contains(credentials.password)) }) return null
        if (!imagePath.matches(url.encodedPath) && parts.none { it.lowercase() in imageDirectory }) return null
        if (url.queryParameterNames.any { name -> name !in resize ||
                url.queryParameterValues(name).size != 1 ||
                url.queryParameter(name)?.matches(Regex("[0-9]{1,4}")) != true }) return null
        return url.toString()
    }

    fun providerUrl(raw: String?, credentials: ExternalStreamConnectClient.Credentials?): String? =
        if (credentials == null) safeUrl(raw) else publicImageUrl(raw, credentials)

    val client by lazy {
        ExternalStreamConnectVerifier.directClient.newBuilder()
            .connectTimeout(4,TimeUnit.SECONDS)
            .readTimeout(8,TimeUnit.SECONDS)
            .callTimeout(18,TimeUnit.SECONDS)
            .retryOnConnectionFailure(true)
            .addInterceptor { chain ->
                val request = chain.request()
                var url = request.url
                if (publicImageUrl(url.toString()) == null || request.method != "GET")
                    throw IOException("Artwork route denied")
                var response = chain.proceed(request.newBuilder().removeHeader("Authorization").removeHeader("Cookie").build())
                var hops = 0
                while (response.code in setOf(301,302,303,307,308)) {
                    val location = response.header("Location")
                    response.close()
                    val next = location?.let(url::resolve)
                    if (++hops > 3 || next == null || publicImageUrl(next.toString()) == null ||
                        (url.scheme == "https" && next.scheme != "https"))
                        throw IOException("Artwork redirect denied")
                    url = next
                    response = chain.proceed(request.newBuilder().url(url).removeHeader("Authorization")
                        .removeHeader("Cookie").removeHeader("Referer").build())
                }
                response
            }
            .build()
    }
}
