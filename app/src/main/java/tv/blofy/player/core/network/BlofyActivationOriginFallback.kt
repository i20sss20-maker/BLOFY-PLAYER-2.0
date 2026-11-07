package tv.blofy.player.core.network

import okhttp3.HttpUrl
import okhttp3.Interceptor
import okhttp3.Response
import java.net.UnknownHostException
import javax.net.ssl.SSLHandshakeException

/**
 * The custom BLOFY API name and the Railway-managed hostname route to the SAME
 * BLOFY activation service. A device DNS/TLS handshake failure on the custom
 * hostname can be recovered using Railway's own trusted TLS hostname.
 *
 * We never disable TLS validation, alter an entitlement or follow a redirect.
 * Only DNS resolution and TLS *handshake* failures trigger one fallback attempt.
 */
internal class BlofyActivationOriginFallback : Interceptor {
    override fun intercept(chain: Interceptor.Chain): Response {
        val original = chain.request()
        val fallback = fallbackUrl(original.url) ?: return chain.proceed(original)
        try {
            return chain.proceed(original)
        } catch (error: UnknownHostException) {
            android.util.Log.w("BlofyNetwork", "Primary activation DNS unavailable; retrying trusted Railway origin")
        } catch (error: SSLHandshakeException) {
            android.util.Log.w("BlofyNetwork", "Primary activation TLS handshake failed; retrying trusted Railway origin")
        }
        // This request is still authenticated by the *same* activation backend.
        // No API secrets, pairing code, URL or request body are logged.
        return chain.proceed(original.newBuilder().url(fallback).build())
    }

    companion object {
        private const val PRIMARY = "api.blofyplayer.com"
        private const val FALLBACK = "blofy-activation-portal-production.up.railway.app"

        internal fun fallbackUrl(url: HttpUrl): HttpUrl? {
            if (!url.isHttps || url.host != PRIMARY || url.port != 443) return null
            return url.newBuilder().host(FALLBACK).build()
        }
    }
}
