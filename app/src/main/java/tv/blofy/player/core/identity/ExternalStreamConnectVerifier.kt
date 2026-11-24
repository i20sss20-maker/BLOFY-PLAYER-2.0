package tv.blofy.player.core.identity

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.Dns
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import tv.blofy.player.core.network.awaitResponse
import java.net.InetAddress
import java.net.Proxy
import java.net.UnknownHostException
import java.util.concurrent.TimeUnit

/**
 * Read-only account verification from the user's device, not BLOFY's server.
 * No redirects, proxy, BLOFY bearer or logging. Does not download content.
 */
object ExternalStreamConnectVerifier {
    enum class Status { ACTIVE, INACTIVE, UNAVAILABLE }
    data class Result(val status: Status, val expiresAt: Long? = null)

    // A conservative allowlist: public IPv4 and globally routed IPv6.
    // Reject mixed public/private DNS responses, including rebinding attempts.
    internal fun publicAddress(address: InetAddress): Boolean {
        if (address.isAnyLocalAddress || address.isLoopbackAddress ||
            address.isLinkLocalAddress || address.isSiteLocalAddress || address.isMulticastAddress) return false
        val b = address.address.map { it.toInt() and 255 }
        if (b.size == 4) {
            val a = b[0]; val c = b[1]
            return a in 1..223 && a != 10 && a != 127 &&
                !(a == 100 && c in 64..127) && !(a == 169 && c == 254) &&
                !(a == 172 && c in 16..31) && !(a == 192 && c in setOf(0, 168)) &&
                !(a == 198 && c in setOf(18, 19)) &&
                !(a == 198 && c == 51 && b[2] == 100) &&
                !(a == 203 && c == 0 && b[2] == 113)
        }
        return b.size == 16 && b[0] in 0x20..0x3f &&
            !(b[0] == 0x20 && b[1] == 0x02) &&
            !(b[0] == 0x20 && b[1] == 0x01 && b[2] == 0x0d && b[3] == 0xb8) &&
            !(b[0] == 0x20 && b[1] == 0x01 && b[2] < 0x02)
    }

    private val client = OkHttpClient.Builder()
        .dns(object : Dns {
            override fun lookup(hostname: String): List<InetAddress> {
                val addresses = Dns.SYSTEM.lookup(hostname)
                if (addresses.isEmpty() || addresses.any { !publicAddress(it) })
                    throw UnknownHostException("CONNECT provider address rejected")
                return addresses
            }
        })
        .proxy(Proxy.NO_PROXY)
        .connectTimeout(8, TimeUnit.SECONDS)
        .readTimeout(10, TimeUnit.SECONDS)
        .callTimeout(15, TimeUnit.SECONDS)
        .followRedirects(false)
        .followSslRedirects(false)
        .retryOnConnectionFailure(false)
        .build()

    internal fun classify(auth: String, status: String): Status = when {
        auth == "0" || auth.equals("false", true) -> Status.INACTIVE
        status.lowercase() in setOf("expired", "disabled", "banned", "inactive") -> Status.INACTIVE
        (auth == "1" || auth.equals("true", true)) && status.equals("active", true) -> Status.ACTIVE
        else -> Status.UNAVAILABLE
    }

    suspend fun verify(credentials: ExternalStreamConnectClient.Credentials): Result =
        withContext(Dispatchers.IO) {
            val host = ExternalStreamConnectClient.parseHost(credentials.host.toString())
                ?: return@withContext Result(Status.UNAVAILABLE)
            val url = host.newBuilder().addPathSegment("player_api.php")
                .addQueryParameter("username", credentials.username)
                .addQueryParameter("password", credentials.password).build()
            val req = Request.Builder().url(url).get()
                .header("Accept", "application/json").header("Cache-Control", "no-store").build()
            try {
                client.newCall(req).awaitResponse().use { res ->
                    if (res.code == 401 || res.code == 403) return@withContext Result(Status.INACTIVE)
                    if (!res.isSuccessful) return@withContext Result(Status.UNAVAILABLE)
                    val source = res.body?.source() ?: return@withContext Result(Status.UNAVAILABLE)
                    source.request(65537)
                    if (source.buffer.size > 65536) return@withContext Result(Status.UNAVAILABLE)
                    val user = JSONObject(source.readUtf8()).optJSONObject("user_info")
                        ?: return@withContext Result(Status.UNAVAILABLE)
                    val status = classify(user.optString("auth"), user.optString("status"))
                    val expires = user.optString("exp_date").toLongOrNull()
                        ?.takeIf { it in 1..253402300799L }?.times(1000)
                    Result(status, if (status == Status.ACTIVE) expires else null)
                }
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (_: Exception) { Result(Status.UNAVAILABLE) }
        }
}
