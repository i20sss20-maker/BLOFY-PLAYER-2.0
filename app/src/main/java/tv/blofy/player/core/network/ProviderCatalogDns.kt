package tv.blofy.player.core.network

import java.net.InetAddress
import java.net.UnknownHostException
import java.util.Locale
import java.util.concurrent.TimeUnit
import okhttp3.Dns
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.OkHttpClient
import okhttp3.dnsoverhttps.DnsOverHttps

/**
 * DNS resilience for provider catalog/API traffic only.
 *
 * Some Android TV/receiver firmwares intermittently fail their platform DNS resolver even while
 * the Internet connection is healthy. Xtream catalog requests may then fail with
 * UnknownHostException before the app can save the base catalog.
 *
 * Keep the platform resolver as the fast path. Only after UnknownHostException, and only for
 * ordinary public-looking DNS hostnames, retry through public DNS-over-HTTPS resolvers.
 * Local/private naming conventions are intentionally never sent to public DNS.
 *
 * This resolver is attached to XtreamClient only. Playback engines and playback routing are not
 * changed by this class.
 */
internal object ProviderCatalogDns {
    private val bootstrapClient by lazy {
        OkHttpClient.Builder()
            .callTimeout(6, TimeUnit.SECONDS)
            .connectTimeout(4, TimeUnit.SECONDS)
            .readTimeout(6, TimeUnit.SECONDS)
            .build()
    }

    private val fallbacks: List<Dns> by lazy {
        listOf(
            DnsOverHttps.Builder()
                .client(bootstrapClient)
                .url("https://cloudflare-dns.com/dns-query".toHttpUrl())
                .bootstrapDnsHosts(
                    ipv4(1, 1, 1, 1),
                    ipv4(1, 0, 0, 1)
                )
                .includeIPv6(false)
                .build(),
            DnsOverHttps.Builder()
                .client(bootstrapClient)
                .url("https://dns.google/dns-query".toHttpUrl())
                .bootstrapDnsHosts(
                    ipv4(8, 8, 8, 8),
                    ipv4(8, 8, 4, 4)
                )
                .includeIPv6(false)
                .build()
        )
    }

    val resolver: Dns by lazy {
        ResilientProviderDns(
            system = Dns.SYSTEM,
            fallbacks = fallbacks
        )
    }

    private fun ipv4(a: Int, b: Int, c: Int, d: Int): InetAddress =
        InetAddress.getByAddress(byteArrayOf(a.toByte(), b.toByte(), c.toByte(), d.toByte()))
}

internal class ResilientProviderDns(
    private val system: Dns,
    private val fallbacks: List<Dns>
) : Dns {
    @Throws(UnknownHostException::class)
    override fun lookup(hostname: String): List<InetAddress> {
        try {
            return system.lookup(hostname)
        } catch (systemFailure: UnknownHostException) {
            if (!isPublicFallbackCandidate(hostname)) throw systemFailure

            var lastFailure: UnknownHostException = systemFailure
            for (fallback in fallbacks) {
                try {
                    val addresses = fallback.lookup(hostname)
                    if (addresses.isNotEmpty()) return addresses
                } catch (fallbackFailure: UnknownHostException) {
                    lastFailure = fallbackFailure
                }
            }
            if (lastFailure !== systemFailure) lastFailure.addSuppressed(systemFailure)
            throw lastFailure
        }
    }

    internal fun isPublicFallbackCandidate(hostname: String): Boolean {
        val host = hostname.trim().trimEnd('.').lowercase(Locale.US)
        if (host.isBlank() || !host.contains('.')) return false
        if (
            host == "localhost" ||
            host.endsWith(".localhost") ||
            host.endsWith(".local") ||
            host.endsWith(".internal") ||
            host.endsWith(".lan") ||
            host.endsWith(".home") ||
            host.endsWith(".home.arpa")
        ) return false

        // Numeric IP literals do not need public DNS and should never be leaked to DoH.
        if (host.contains(':')) return false
        if (host.split('.').size == 4 && host.split('.').all { part ->
                part.isNotBlank() && part.all(Char::isDigit) && (part.toIntOrNull() ?: -1) in 0..255
            }) return false

        return true
    }
}
