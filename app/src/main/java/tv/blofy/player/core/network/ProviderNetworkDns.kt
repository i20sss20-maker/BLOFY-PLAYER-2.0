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
    val resolver: Dns by lazy {
        ResilientProviderDns(
            system = Dns.SYSTEM,
            fallback = DnsOverHttps.Builder()
                .client(
                    OkHttpClient.Builder()
                        .callTimeout(5, TimeUnit.SECONDS)
                        .connectTimeout(4, TimeUnit.SECONDS)
                        .readTimeout(5, TimeUnit.SECONDS)
                        .build()
                )
                .url("https://cloudflare-dns.com/dns-query".toHttpUrl())
                .bootstrapDnsHosts(
                    ipv4(1, 1, 1, 1),
                    ipv4(1, 0, 0, 1)
                )
                .includeIPv6(false)
                .build()
        )
    }

    private fun ipv4(a: Int, b: Int, c: Int, d: Int): InetAddress =
        InetAddress.getByAddress(byteArrayOf(a.toByte(), b.toByte(), c.toByte(), d.toByte()))
}

internal class ResilientProviderDns(
    private val system: Dns,
    private val fallback: Dns
) : Dns {
    @Throws(UnknownHostException::class)
    override fun lookup(hostname: String): List<InetAddress> {
        try {
            return system.lookup(hostname)
        } catch (systemFailure: UnknownHostException) {
            if (!isPublicHostname(hostname)) throw systemFailure

            try {
                return fallback.lookup(hostname)
            } catch (fallbackFailure: UnknownHostException) {
                fallbackFailure.addSuppressed(systemFailure)
                throw fallbackFailure
            }
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
