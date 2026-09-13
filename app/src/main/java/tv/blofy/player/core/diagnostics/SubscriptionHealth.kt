package tv.blofy.player.core.diagnostics

import kotlinx.coroutines.suspendCancellableCoroutine
import okhttp3.*
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import org.json.JSONObject
import tv.blofy.player.data.local.ProviderEntity
import java.io.IOException
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import java.util.concurrent.TimeUnit
import kotlin.coroutines.resume

/** Reads account metadata only. A check never opens a channel or consumes a stream slot. */
object SubscriptionHealth {
    enum class State { ACTIVE, EXPIRED, BLOCKED, INVALID, CONNECTION_LIMIT, DNS, TIMEOUT, UNREACHABLE, UNKNOWN, UNSUPPORTED }
    data class Result(val state: State, val expiresAt: Long? = null, val connections: Int? = null, val limit: Int? = null)
    private val client = OkHttpClient.Builder().connectTimeout(4, TimeUnit.SECONDS)
        .readTimeout(8, TimeUnit.SECONDS).callTimeout(12, TimeUnit.SECONDS).build()

    suspend fun check(provider: ProviderEntity): Result {
        if (!provider.providerType.equals("xtream", true)) return Result(State.UNSUPPORTED)
        val url = (provider.baseUrl.trimEnd('/') + "/player_api.php").toHttpUrlOrNull()?.newBuilder()
            ?.addQueryParameter("username", provider.username)?.addQueryParameter("password", provider.password)?.build()
            ?: return Result(State.UNREACHABLE)
        return suspendCancellableCoroutine { continuation ->
            val call = client.newCall(Request.Builder().url(url).build())
            continuation.invokeOnCancellation { call.cancel() }
            call.enqueue(object : Callback {
                override fun onFailure(call: Call, error: IOException) {
                    if (continuation.isActive) continuation.resume(Result(when (error) {
                        is UnknownHostException -> State.DNS
                        is SocketTimeoutException, is java.io.InterruptedIOException -> State.TIMEOUT
                        else -> State.UNREACHABLE
                    }))
                }
                override fun onResponse(call: Call, response: Response) {
                    val result = response.use {
                        if (!it.isSuccessful) Result(if (it.code == 401 || it.code == 403) State.INVALID else State.UNREACHABLE)
                        else runCatching {
                            // Account replies are small; do not buffer an unexpected media response.
                            val reader = it.body?.charStream() ?: return@runCatching Result(State.UNKNOWN)
                            val buffer = CharArray(65_537)
                            var count = 0
                            while (count < buffer.size) {
                                val n = reader.read(buffer, count, buffer.size - count)
                                if (n < 0) break
                                count += n
                            }
                            if (count > 65_536) Result(State.UNKNOWN) else parse(JSONObject(String(buffer, 0, count)))
                        }.getOrDefault(Result(State.UNKNOWN))
                    }
                    if (continuation.isActive) continuation.resume(result)
                }
            })
        }
    }

    internal fun parse(payload: JSONObject, now: Long = System.currentTimeMillis()): Result {
        val info = payload.optJSONObject("user_info") ?: return Result(State.UNKNOWN)
        val status = info.optString("status").lowercase(java.util.Locale.ROOT)
        val expiry = info.optString("exp_date").toDoubleOrNull()?.takeIf { it.isFinite() && it > 0 }?.let { (it * 1000).toLong() }
        val connections = info.optString("active_cons").toDoubleOrNull()?.toInt()?.takeIf { it >= 0 }
        val limit = info.optString("max_connections").toDoubleOrNull()?.toInt()?.takeIf { it > 0 }
        val state = when {
            status == "expired" || (expiry != null && expiry <= now) -> State.EXPIRED
            status in listOf("banned", "disabled", "blocked") -> State.BLOCKED
            info.has("auth") && info.optString("auth") !in listOf("1", "1.0") -> State.INVALID
            status != "active" -> State.UNKNOWN
            connections != null && limit != null && connections >= limit -> State.CONNECTION_LIMIT
            else -> State.ACTIVE
        }
        return Result(state, expiry, connections, limit)
    }
}
