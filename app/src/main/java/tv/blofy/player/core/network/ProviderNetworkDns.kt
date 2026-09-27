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
 * DNS resilience for provider control-plane requests (Xtream catalog/API only).
 *
 * The Android platform resolver remains the fast path. Some TV boxes/receivers intermittently
 * return UnknownHostException even while public DNS can resolve the provider host. In that case
 * retry through DNS-over-HTTPS. Local/private provider hostnames are intentionally excluded.
 *
 * Playback engines are not wired to this resolver.
 */
internal object ProviderNetworkDns {
    private val dohClient by lazy {
        OkHttpClient.Builder()
            .callTimeout(6, TimeUnit.SECONDS)
            .connectTimeout(4, TimeUnit.SECONDS)
            .readTimeout(6, TimeUnit.SECONDS)
            .build()
    }

    val resolver: Dns by lazy {
        ResilientProviderDns(
            system = Dns.SYSTEM,
            fallbacks = listOf(
                DnsOverHttps.Builder()
                    .client(dohClient)
                    .url("https://cloudflare-dns.com/dns-query".toHttpUrl())
                    .bootstrapDnsHosts(
                        ipv4(1, 1, 1, 1),
                        ipv4(1, 0, 0, 1)
                    )
                    .includeIPv6(false)
                    .build(),
                DnsOverHttps.Builder()
                    .client(dohClient)
                    .url("https://dns.google/dns-query".toHttpUrl())
                    .bootstrapDnsHosts(
                        ipv4(8, 8, 8, 8),
                        ipv4(8, 8, 4, 4)
                    )
                    .includeIPv6(false)
                    .build()
            )
        )
    }

    private fun ipv4(a: Int, b: Int, c: Int, d: Int): InetAddress =
        InetAddress.getByAddress(byteArrayOf(a.toByte(), b.toByte(), c.toByte(), d.toByte()))
}

internal class ResilientProviderDns(
    private val system: Dns,
    fallback: Dns? = null,
    fallbacks: List<Dns> = fallback?.let { listOf(it) } ?: emptyList()
) : Dns {
    private val fallbackResolvers: List<Dns> = fallbacks
    @Throws(UnknownHostException::class)
    override fun lookup(hostname: String): List<InetAddress> {
        try {
            return system.lookup(hostname)
        } catch (systemFailure: UnknownHostException) {
            if (!isPublicHostname(hostname)) throw systemFailure

            var lastFailure: UnknownHostException = systemFailure
            for (fallbackResolver in fallbackResolvers) {
                try {
                    val addresses = fallbackResolver.lookup(hostname)
                    if (addresses.isNotEmpty()) return addresses
                } catch (fallbackFailure: UnknownHostException) {
                    lastFailure = fallbackFailure
                }
            }
            if (lastFailure !== systemFailure) lastFailure.addSuppressed(systemFailure)
            throw lastFailure
        }
    }

    private fun isPublicHostname(raw: String): Boolean {
        val host = raw.trim().trimEnd('.').lowercase(Locale.US)
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
        if (host.matches(Regex("""\d{1,3}(?:\.\d{1,3}){3}"""))) return false
        if (host.contains(':')) return false
        return true
    }
}
