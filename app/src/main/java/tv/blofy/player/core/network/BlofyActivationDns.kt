package tv.blofy.player.core.network

import android.util.Log
import okhttp3.Dns
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import java.io.IOException
import java.net.InetAddress
import java.net.UnknownHostException
import java.util.concurrent.TimeUnit

/**
 * DNS fallback for the two first-party BLOFY activation service origins only.
 *
 * The system resolver is always tried first. If it cannot resolve the domain,
 * retry using authenticated HTTPS DNS with a fixed bootstrap IP. This prevents
 * the resolver's own hostname from depending on the broken system DNS.
 *
 * DoH is DNS resolution only: OkHttp still verifies the actual activation
 * server's HTTPS certificate and hostname as usual.
 */
internal object BlofyActivationDns : Dns {
    private const val PRIMARY = "api.blofyplayer.com"
    private const val RAILWAY = "blofy-activation-portal-production.up.railway.app"
    private val ipv4Pattern = Regex("(?:\\d{1,3}\\.){3}\\d{1,3}")

    private val dohClient by lazy {
        OkHttpClient.Builder()
            .dns(Dns { name ->
                when (name) {
                    "dns.google" -> listOf(InetAddress.getByAddress(byteArrayOf(8, 8, 8, 8)))
                    "cloudflare-dns.com" -> listOf(InetAddress.getByAddress(byteArrayOf(1, 1, 1, 1)))
                    else -> Dns.SYSTEM.lookup(name)
                }
            })
            .connectTimeout(3, TimeUnit.SECONDS)
            .readTimeout(3, TimeUnit.SECONDS)
            .callTimeout(5, TimeUnit.SECONDS)
            .followRedirects(false)
            .followSslRedirects(false)
            .build()
    }

    override fun lookup(hostname: String): List<InetAddress> {
        return lookupWithResolvers(hostname, Dns.SYSTEM::lookup, ::resolveViaHttps)
    }

    internal fun lookupWithResolvers(
        hostname: String,
        system: (String) -> List<InetAddress>,
        secureFallback: (String) -> List<InetAddress>
    ): List<InetAddress> {
        try {
            return system(hostname).takeIf { it.isNotEmpty() } ?: throw UnknownHostException(hostname)
        } catch (error: UnknownHostException) {
            if (hostname != PRIMARY && hostname != RAILWAY) throw error
            Log.w("BlofyNetwork", "System DNS unavailable for activation origin; trying secure DNS")
        }
        return try {
            secureFallback(hostname).takeIf { it.isNotEmpty() }
                ?: throw UnknownHostException("Secure DNS returned no activation addresses")
        } catch (error: Exception) {
            val failure = UnknownHostException("Activation DNS failed using system and secure resolvers")
            failure.initCause(error)
            throw failure
        }
    }

    private fun resolveViaHttps(hostname: String): List<InetAddress> {
        var lastFailure: IOException? = null
        for (resolver in listOf(
            "https://dns.google/resolve",
            "https://cloudflare-dns.com/dns-query"
        )) {
            try {
                val url: HttpUrl = requireNotNull(resolver.toHttpUrlOrNull())
                    .newBuilder().addQueryParameter("name", hostname)
                    .addQueryParameter("type", "A").build()
                val request = Request.Builder().url(url)
                    .header("Accept", "application/dns-json")
                    .get().build()
                dohClient.newCall(request).execute().use { response ->
                    if (!response.isSuccessful) throw IOException("Secure resolver rejected request")
                    val json = JSONObject(response.body?.string() ?: throw IOException("No DNS response"))
                    if (json.optInt("Status", -1) != 0) throw IOException("Secure resolver returned error")
                    val answers = json.optJSONArray("Answer") ?: throw IOException("No DNS records")
                    val addresses = mutableListOf<InetAddress>()
                    for (i in 0 until answers.length()) {
                        val record = answers.optJSONObject(i) ?: continue
                        if (record.optInt("type") != 1) continue
                        val bytes = parseIpv4(record.optString("data")) ?: continue
                        addresses.add(InetAddress.getByAddress(bytes))
                    }
                    if (addresses.isNotEmpty()) return addresses
                    throw IOException("No usable IPv4 address")
                }
            } catch (error: IOException) {
                lastFailure = error
            } catch (error: Exception) {
                lastFailure = IOException("Invalid secure DNS response", error)
            }
        }
        throw lastFailure ?: UnknownHostException("Secure DNS not available")
    }

    private fun parseIpv4(value: String): ByteArray? {
        if (!ipv4Pattern.matches(value)) return null
        val parts = value.split('.').map { it.toIntOrNull() ?: return null }
        if (parts.any { it !in 0..255 }) return null
        return ByteArray(4) { parts[it].toByte() }
    }
}
