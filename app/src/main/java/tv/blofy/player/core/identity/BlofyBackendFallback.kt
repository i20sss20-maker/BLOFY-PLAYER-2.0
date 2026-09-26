package tv.blofy.player.core.identity

import java.io.IOException
import java.net.ProtocolException
import java.net.URI
import javax.net.ssl.SSLException
import retrofit2.HttpException

/**
 * Network-only fallback for the BLOFY activation/portal service.
 *
 * Credentials may only fail over to BLOFY's own Railway service hostname. Authentication
 * failures and TLS/protocol failures never fail over.
 */
internal object BlofyBackendFallback {
    private const val PRIMARY_HOST = "api.blofyplayer.com"
    const val RAILWAY_BASE_URL = "https://blofy-activation-portal-production.up.railway.app"

    fun candidates(baseUrl: String): List<String> {
        val primary = normalize(baseUrl)
        val host = runCatching { URI(primary).host.orEmpty().lowercase() }.getOrDefault("")
        if (host != PRIMARY_HOST) return listOf(primary)
        val fallback = normalize(RAILWAY_BASE_URL)
        return if (primary.equals(fallback, ignoreCase = true)) listOf(primary) else listOf(primary, fallback)
    }

    fun shouldFailOver(error: Throwable): Boolean = when (error) {
        is SSLException, is ProtocolException -> false
        is IOException -> true
        is HttpException -> error.code() in setOf(408, 502, 503, 504)
        else -> false
    }

    fun normalize(value: String): String = value.trim().trimEnd('/')
}
