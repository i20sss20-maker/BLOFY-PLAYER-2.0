package tv.blofy.player.core.identity

import android.os.Build
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.util.concurrent.TimeUnit
import tv.blofy.player.core.network.awaitResponse

/**
 * The code-only client never prompts for Xtream host, user or password.
 * These credentials are issued by the trusted BLOFY server, over HTTPS.
 */
object StreamCodeClient {
    class ReloginApprovalRequired : IllegalStateException("stream_code_relogin_required")
    data class ReloginRequest(
        val requestCode: String? = null,
        val alreadyAuthorized: Boolean = false
    )
    data class Activated(
        val accessToken: String,
        val activatedAt: Long,
        val expiresAt: Long
    )

    // Allow a slower TLS handshake on Android 7–9 without changing certificate checks.
    // Server-issued expiry remains authoritative even if the TV clock is wrong.
    private val client = OkHttpClient.Builder()
        .callTimeout(if (Build.VERSION.SDK_INT <= Build.VERSION_CODES.P) 40 else 25, TimeUnit.SECONDS)
        .connectTimeout(if (Build.VERSION.SDK_INT <= Build.VERSION_CODES.P) 15 else 8, TimeUnit.SECONDS)
        .readTimeout(if (Build.VERSION.SDK_INT <= Build.VERSION_CODES.P) 30 else 20, TimeUnit.SECONDS)
        .followRedirects(false)
        .followSslRedirects(false)
        .build()
    private val jsonType = "application/json; charset=utf-8".toMediaType()

    fun normalizeCode(value: String): String {
        val converted = buildString {
            for (ch in value.trim()) {
                append(
                    when (ch) {
                        in '٠'..'٩' -> ('0'.code + ch.code - '٠'.code).toChar()
                        in '۰'..'۹' -> ('0'.code + ch.code - '۰'.code).toChar()
                        else -> ch
                    }
                )
            }
        }.uppercase().replace(Regex("[\\s-]+"), "")
        return converted.takeIf {
            it.matches(Regex("[0-9]{8,12}")) ||
                it.matches(Regex("[A-F0-9]{24}"))
        } ?: ""
    }

    // Do not use the device wall clock to decide whether a code is expired:
    // Android 9 TV boxes can have incorrect time. The server owns expiry.
    data class SessionStatus(
        val active: Boolean,
        val daysRemaining: Int? = null,
        val expiresAt: Long? = null
    )

    suspend fun sessionStatus(accessToken: String): SessionStatus? =
        withContext(Dispatchers.IO) {
            val request=Request.Builder()
                .url("${StreamCodeSession.HOST}/api/v1/stream/app/session")
                .get().header("Authorization","Bearer $accessToken")
                .header("Cache-Control","no-store").build()
            try {
                client.newCall(request).awaitResponse().use { response ->
                    if(response.code==401||response.code==403)
                        return@withContext SessionStatus(false)
                    if(!response.isSuccessful)return@withContext null
                    val body=JSONObject(response.body?.string().orEmpty())
                    if(!body.optBoolean("ok")||!body.optBoolean("active"))
                        return@withContext SessionStatus(false)
                    SessionStatus(active=true,
                        daysRemaining=body.optInt("daysRemaining",-1)
                            .takeIf { it>=0 },
                        expiresAt=body.optLong("expiresAt",0)
                            .takeIf { it>0 })
                }
            } catch (_: Exception) { null }
        }

    suspend fun verifySession(accessToken: String): Boolean? =
        sessionStatus(accessToken)?.active

    /**
     * A device whose installation key changed may request a six-digit,
     * operator-approved re-login. This does NOT create a new subscription,
     * grant two devices or expose the Xtream source credentials.
     */
    suspend fun requestRelogin(rawCode: String, deviceKey: String): ReloginRequest =
        withContext(Dispatchers.IO) {
            val code = normalizeCode(rawCode)
            require(code.isNotEmpty()) { "invalid_code" }
            require(deviceKey.matches(Regex("[a-f0-9]{64}"))) { "invalid_installation" }
            val body = JSONObject().put("code", code).put("deviceKey", deviceKey).toString()
            val request = Request.Builder()
                .url("${StreamCodeSession.HOST}/api/v1/stream/app/relogin-request")
                .post(body.toRequestBody(jsonType))
                .header("Accept", "application/json")
                .header("Cache-Control", "no-store")
                .build()
            client.newCall(request).awaitResponse().use { response ->
                val data = runCatching { JSONObject(response.body?.string().orEmpty()) }
                    .getOrElse { JSONObject() }
                if (!response.isSuccessful || !data.optBoolean("ok")) {
                    error(when (data.optString("error")) {
                        "stream_code_relogin_already_pending" ->
                            "stream_code_relogin_already_pending"
                        "stream_code_relogin_unavailable" ->
                            "stream_code_relogin_unavailable"
                        "stream_code_rate_limited" -> "stream_code_rate_limited"
                        else -> "stream_code_relogin_failed"
                    })
                }
                if (data.optBoolean("alreadyAuthorized"))
                    return@withContext ReloginRequest(alreadyAuthorized = true)
                val pin = data.optString("requestCode")
                require(pin.matches(Regex("[0-9]{6}"))) { "stream_code_relogin_failed" }
                ReloginRequest(requestCode = pin)
            }
        }

    suspend fun redeem(rawCode: String, deviceKey: String): Activated = withContext(Dispatchers.IO) {
        val code = normalizeCode(rawCode)
        require(code.isNotEmpty()) { "أدخل كود التفعيل الصحيح" }
        val body = JSONObject().put("code", code).put("deviceKey", deviceKey).toString()
        val request = Request.Builder()
            .url("${StreamCodeSession.HOST}/api/v1/stream/app/redeem")
            .post(body.toRequestBody(jsonType))
            .header("Accept", "application/json")
            .header("Cache-Control", "no-store")
            .build()
        client.newCall(request).awaitResponse().use { response ->
            val root = runCatching { JSONObject(response.body?.string().orEmpty()) }
                .getOrElse { JSONObject() }
            if (!response.isSuccessful || !root.optBoolean("ok")) {
                if (response.code == 409 && root.optString("error") == "stream_code_unavailable")
                    throw ReloginApprovalRequired()
                error(when (response.code) {
                    409 -> "الكود مستخدم أو غير متاح. تواصل مع المسؤول"
                    429 -> "محاولات كثيرة، أعد المحاولة لاحقًا"
                    400 -> "كود غير صحيح"
                    else -> "تعذر تفعيل الكود. تحقق من الاتصال"
                })
            }
            val account = root.optJSONObject("account") ?: error("استجابة التفعيل غير مكتملة")
            val token=root.optString("accessToken")
            require(root.optString("tokenType")=="Bearer" &&
                token.matches(Regex("v1\\.[0-9a-f-]{36}\\.[A-Za-z0-9_-]{43}"))) {
                "جلسة التفعيل غير صالحة"
            }
            val activatedAt = account.optLong("activatedAt")
            val expiresAt = account.optLong("expiresAt")
            require(activatedAt > 0 && expiresAt > activatedAt) { "مدة الاشتراك غير صالحة" }
            Activated(token,activatedAt,expiresAt)
        }
    }
}
