package tv.blofy.player.core.network

import java.net.InetAddress
import java.net.UnknownHostException
import java.util.concurrent.TimeUnit
import okhttp3.Dns
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.OkHttpClient
import okhttp3.dnsoverhttps.DnsOverHttps

/**
 * DNS resilience for BLOFY-owned control-plane hosts only.
 *
 * Android TV boxes and receivers occasionally return UnknownHostException from the platform
 * resolver while the network itself is healthy. Keep the system resolver as the fast path, then
 * fall back to DNS-over-HTTPS only for BLOFY infrastructure. IPTV/provider hosts are intentionally
 * excluded so this cannot change playback routing or provider DNS behavior.
 */
internal object BlofyNetworkDns {
    private val blofyHosts = setOf(
        "api.blofyplayer.com",
        "blofyplayer.com",
        "blofy-activation-portal-production.up.railway.app"
    )

    val resolver: Dns by lazy {
        ResilientBlofyDns(
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
                .build(),
            fallbackHosts = blofyHosts
        )
    }

    private fun ipv4(a: Int, b: Int, c: Int, d: Int): InetAddress =
        InetAddress.getByAddress(byteArrayOf(a.toByte(), b.toByte(), c.toByte(), d.toByte()))
}

internal class ResilientBlofyDns(
    private val system: Dns,
    private val fallback: Dns,
    private val fallbackHosts: Set<String>
) : Dns {
    @Throws(UnknownHostException::class)
    override fun lookup(hostname: String): List<InetAddress> {
        try {
            return system.lookup(hostname)
        } catch (systemFailure: UnknownHostException) {
            if (hostname.lowercase() !in fallbackHosts) throw systemFailure

            try {
                return fallback.lookup(hostname)
            } catch (fallbackFailure: UnknownHostException) {
                fallbackFailure.addSuppressed(systemFailure)
                throw fallbackFailure
            }
        }
    }
}
