package tv.blofy.player.core.identity

import android.os.Build
import com.google.gson.JsonObject
import com.google.gson.JsonParser
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import tv.blofy.player.core.network.awaitResponse
import java.util.concurrent.TimeUnit

/** QA contract: the server decides the code type. Never attempt two endpoints. */
internal object UnifiedStreamCodeClient {
    sealed interface Result {
        class Paid(val session: StreamCodeClient.Activated) : Result
        class External(val credentials: ExternalStreamConnectClient.Credentials) : Result
    }

    private val client by lazy {
        OkHttpClient.Builder()
            .connectTimeout(if (Build.VERSION.SDK_INT <= 28) 15 else 8, TimeUnit.SECONDS)
            .readTimeout(30, TimeUnit.SECONDS)
            .callTimeout(40, TimeUnit.SECONDS)
            .followRedirects(false).followSslRedirects(false)
            .retryOnConnectionFailure(false)
            .build()
    }

    fun normalize(raw: String): String? {
        if (raw.length > 64) return null
        val trimmed = raw.trim()
        if (trimmed.startsWith("BC-")) return ExternalStreamConnectClient.normalizeCode(trimmed)
        return StreamCodeClient.normalizeCode(trimmed).takeIf { it.isNotEmpty() }
    }

    internal fun decode(raw: String): Result {
        require(raw.length <= 8192)
        val root = JsonParser.parseString(raw).asJsonObject
        require(root.get("ok")?.asBoolean == true)
        return when (root.get("type")?.asString) {
            "blofy_stream" -> {
                require(!root.has("credentials"))
                val account = root.getAsJsonObject("account")
                val token = root.get("accessToken").asString
                val activated = account.get("activatedAt").asLong
                val expires = account.get("expiresAt").asLong
                require(root.get("tokenType").asString == "Bearer" &&
                    token.matches(Regex("v1\\.[0-9a-f-]{36}\\.[A-Za-z0-9_-]{43}")) &&
                    activated > 0 && expires > activated)
                Result.Paid(StreamCodeClient.Activated(token, activated, expires))
            }
            "external_xtream" -> {
                require(!root.has("accessToken") && !root.has("account") &&
                    root.get("providerVerified")?.asBoolean == false)
                val data = root.getAsJsonObject("credentials")
                val host = requireNotNull(ExternalStreamConnectClient.parseHost(data.get("host").asString))
                val username = data.get("username").asString
                val password = data.get("password").asString
                require(username.length in 1..256 && password.length in 1..256 &&
                    (username + password).none { it.code < 32 || it.code == 127 })
                Result.External(ExternalStreamConnectClient.Credentials(host, username, password))
            }
            else -> error("Invalid unified activation response")
        }
    }

    suspend fun redeem(rawCode: String, deviceKey: String): Result =
        redeemRequest(rawCode,deviceKey,client,StreamCodeSession.HOST)

    // Internal test seam: production always uses the pinned first-party origin.
    internal suspend fun redeemRequest(rawCode: String, deviceKey: String,
        transport: OkHttpClient, origin: String): Result = withContext(Dispatchers.IO) {
        val code = requireNotNull(normalize(rawCode)) { "كود غير صحيح" }
        require(deviceKey.matches(Regex("[a-f0-9]{64}")))
        val body = JsonObject().apply {
            addProperty("code", code)
            addProperty("deviceKey", deviceKey)
        }
        val request = Request.Builder()
            .url("$origin/api/v1/stream/app/unified-redeem")
            .post(body.toString().toRequestBody("application/json; charset=utf-8".toMediaType()))
            .header("Accept", "application/json").header("Cache-Control", "no-store").build()
        transport.newCall(request).awaitResponse().use { response ->
            if (!response.isSuccessful) error(when (response.code) {
                409 -> "الكود مستخدم أو غير متاح. تواصل مع المسؤول"
                429 -> "محاولات كثيرة، أعد المحاولة لاحقًا"
                400 -> "كود غير صحيح"
                else -> "تعذر تفعيل الكود. تحقق من الاتصال"
            })
            val source = response.body?.source() ?: error("استجابة التفعيل غير مكتملة")
            source.request(8193)
            if (source.buffer.size > 8192) error("استجابة التفعيل غير صالحة")
            try {
                decode(source.readUtf8())
            } catch (_: Exception) {
                error("استجابة التفعيل غير صالحة")
            }
        }
    }
}
