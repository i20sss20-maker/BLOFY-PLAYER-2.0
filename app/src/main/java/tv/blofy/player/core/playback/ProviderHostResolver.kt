package tv.blofy.player.core.playback

import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import java.net.InetAddress
import java.util.Locale

/**
 * Repairs provider-supplied playback URLs without guessing that every alternate public CDN is bad.
 *
 * Primary resolution rewrites only clearly local/private hosts. If playback later fails, callers can
 * request [providerOriginFallback] which keeps the media path/query but replaces the complete origin
 * (scheme + host + port) with the reachable provider origin. This also covers hidden hosts that look
 * like normal public DNS names, e.g. a provider-side CDN alias that is not reachable by the client.
 */
object ProviderHostResolver {
    fun resolve(providerBaseUrl: String, sourceUrl: String?): String? {
        val source = sourceUrl.parseHttpUrl() ?: return sourceUrl
        val provider = providerBaseUrl.parseHttpUrl() ?: return sourceUrl
        if (!isClearlyInternal(source.host) || isClearlyInternal(provider.host)) return sourceUrl
        return source.withOrigin(provider).toString()
    }

    /**
     * Builds a safe second route for an arbitrary direct_source using the provider's complete
     * externally reachable origin. The original path/query/fragment are preserved exactly.
     * Returns null when both URLs already use the same origin or either URL is invalid.
     */
    fun providerOriginFallback(providerBaseUrl: String, sourceUrl: String?): String? {
        val source = sourceUrl.parseHttpUrl() ?: return null
        val provider = providerBaseUrl.parseHttpUrl() ?: return null
        if (isClearlyInternal(provider.host) || source.sameOrigin(provider)) return null
        return source.withOrigin(provider).toString()
    }

    internal fun isClearlyInternal(host: String): Boolean {
        val normalized = host.trimEnd('.').lowercase(Locale.US)
        if (normalized.isBlank()) return true
        if (
            normalized == "localhost" ||
            normalized.endsWith(".localhost") ||
            normalized.endsWith(".local") ||
            normalized.endsWith(".internal") ||
            normalized.endsWith(".lan") ||
            normalized.endsWith(".home") ||
            normalized.endsWith(".home.arpa")
        ) return true

        parseIpv4(normalized)?.let { return isPrivateIpv4(it) }
        if (normalized.contains(':')) return isPrivateIpv6(normalized)

        // Single-label DNS names are normally resolvable only inside the provider network.
        return !normalized.contains('.')
    }

    private fun String?.parseHttpUrl(): HttpUrl? = this
        ?.trim()
        ?.takeIf { it.isNotBlank() }
        ?.toHttpUrlOrNull()
        ?.takeIf { it.scheme.equals("http", true) || it.scheme.equals("https", true) }

    private fun HttpUrl.withOrigin(provider: HttpUrl): HttpUrl = newBuilder()
        .scheme(provider.scheme)
        .host(provider.host)
        .port(provider.port)
        .build()

    private fun HttpUrl.sameOrigin(other: HttpUrl): Boolean =
        scheme.equals(other.scheme, true) && host.equals(other.host, true) && port == other.port

    private fun parseIpv4(host: String): IntArray? {
        val parts = host.split('.')
        if (parts.size != 4) return null
        return parts.map { part ->
            if (part.isEmpty() || part.any { !it.isDigit() }) return null
            part.toIntOrNull()?.takeIf { it in 0..255 } ?: return null
        }.toIntArray()
    }

    private fun isPrivateIpv4(parts: IntArray): Boolean {
        val a = parts[0]
        val b = parts[1]
        return a == 0 || a == 10 || a == 127 ||
            (a == 100 && b in 64..127) ||
            (a == 169 && b == 254) ||
            (a == 172 && b in 16..31) ||
            (a == 192 && b == 168) ||
            a >= 224
    }

    private fun isPrivateIpv6(host: String): Boolean {
        val address = runCatching { InetAddress.getByName(host) }.getOrNull() ?: return true
        val bytes = address.address
        if (bytes.size == 4) return isPrivateIpv4(bytes.map { it.toInt() and 0xff }.toIntArray())
        if (bytes.size != 16) return true
        val first = bytes[0].toInt() and 0xff
        val second = bytes[1].toInt() and 0xff
        val allZero = bytes.all { it.toInt() == 0 }
        val loopback = bytes.dropLast(1).all { it.toInt() == 0 } && (bytes.last().toInt() and 0xff) == 1
        val uniqueLocal = first and 0xfe == 0xfc
        val linkLocal = first == 0xfe && second and 0xc0 == 0x80
        val multicast = first == 0xff
        return allZero || loopback || uniqueLocal || linkLocal || multicast
    }
}
