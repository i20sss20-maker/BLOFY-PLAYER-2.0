package tv.blofy.player.core.identity

import java.net.UnknownHostException
import okhttp3.HttpUrl
import okhttp3.Interceptor

/**
 * Fallback for Android TVs whose DNS cannot resolve one BLOFY domain.
 *
 * Railway confirms all three HTTPS hostnames point to the SAME live activation
 * service. Never use a redirect (which could leak pairing credentials), hardcode
 * an IP, or send an arbitrary provider's requests to the BLOFY portal.
 */
internal object ProductionPortalDnsFallback {
    private val ownedHosts = listOf(
        "api.blofyplayer.com",
        "blofyplayer.com",
        "blofy-activation-portal-production.up.railway.app"
    )

    internal fun candidates(url: HttpUrl): List<HttpUrl> {
        if (url.scheme != "https" || url.port != 443 ||
            url.host !in ownedHosts || !url.encodedPath.startsWith("/api/v1/") ||
            url.username.isNotEmpty() || url.password.isNotEmpty()) return listOf(url)
        // Keep query, path, request body and exact resource unchanged.
        // Each alternative gets its own hostname-validated TLS connection.
        return listOf(url) + ownedHosts.filterNot { it == url.host }
            .map { url.newBuilder().host(it).build() }
    }

    val interceptor = Interceptor { chain ->
        val request = chain.request()
        val urls = candidates(request.url)
        var dnsFailure: UnknownHostException? = null
        for (candidate in urls) {
            try {
                return@Interceptor chain.proceed(request.newBuilder().url(candidate).build())
            } catch (e: UnknownHostException) {
                dnsFailure = e
                // A DNS miss occurred before any TCP connection/request body was sent.
                // Never retry on SSL errors, an HTTP denial, or a server response.
            }
        }
        throw dnsFailure ?: UnknownHostException("BLOFY service DNS unavailable")
    }
}
