package tv.blofy.player.core.playback

import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import java.net.InetAddress
import java.util.Locale

/**
 * Rewrites only clearly local/private hosts in provider-supplied playback URLs.
 *
 * Some Xtream/M3U panels publish direct_source/media URLs containing an internal DNS name
 * or RFC1918 address. The public provider URL entered by the user is already reachable, so for
 * those clearly-internal cases BLOFY keeps the source scheme/port/path/query and replaces only
 * the host with the public provider host. Public CDN/alternate hosts are never rewritten.
 */
object ProviderHostResolver {
    fun resolve(providerBaseUrl: String, sourceUrl: String?): String? {
        val source = sourceUrl?.trim()?.takeIf { it.isNotBlank() }?.toHttpUrlOrNull() ?: return sourceUrl
        val provider = providerBaseUrl.trim().toHttpUrlOrNull() ?: return sourceUrl
        if (!isClearlyInternal(source.host)) return sourceUrl
        if (isClearlyInternal(provider.host)) return sourceUrl
        return source.newBuilder().host(provider.host).build().toString()
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
