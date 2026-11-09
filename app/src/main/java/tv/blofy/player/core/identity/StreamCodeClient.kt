package tv.blofy.player.core.identity

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
    data class Activated(
        val username: String,
        val password: String,
        val activatedAt: Long,
        val expiresAt: Long
    )

    private val client = OkHttpClient.Builder()
        .callTimeout(25, TimeUnit.SECONDS)
        .connectTimeout(8, TimeUnit.SECONDS)
        .readTimeout(20, TimeUnit.SECONDS)
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
    suspend fun verifySubscriber(username: String, password: String): Boolean? =
        withContext(Dispatchers.IO) {
            val url = okhttp3.HttpUrl.Builder()
                .scheme("https")
                .host("blofyplayer.com")
                .addPathSegment("player_api.php")
                .addQueryParameter("username", username)
                .addQueryParameter("password", password)
                .build()
            val request = Request.Builder().url(url).get()
                .header("Cache-Control", "no-store").build()
            try {
                client.newCall(request).awaitResponse().use { response ->
                    if (!response.isSuccessful) return@withContext null
                    val data = JSONObject(response.body?.string().orEmpty())
                    data.optJSONObject("user_info")?.optInt("auth") == 1
                }
            } catch (_: Exception) {
                null // network is unavailable, not proof of expiry
            }
        }

    suspend fun redeem(rawCode: String): Activated = withContext(Dispatchers.IO) {
        val code = normalizeCode(rawCode)
        require(code.isNotEmpty()) { "أدخل كود التفعيل الصحيح" }
        val body = JSONObject().put("code", code).toString()
        val request = Request.Builder()
            .url("${StreamCodeSession.HOST}/api/v1/stream/redeem")
            .post(body.toRequestBody(jsonType))
            .header("Accept", "application/json")
            .header("Cache-Control", "no-store")
            .build()
        client.newCall(request).awaitResponse().use { response ->
            val root = runCatching { JSONObject(response.body?.string().orEmpty()) }
                .getOrElse { JSONObject() }
            if (!response.isSuccessful || !root.optBoolean("ok")) {
                error(when (response.code) {
                    409 -> "الكود مستخدم أو غير متاح. تواصل مع المسؤول"
                    429 -> "محاولات كثيرة، أعد المحاولة لاحقًا"
                    400 -> "كود غير صحيح"
                    else -> "تعذر تفعيل الكود. تحقق من الاتصال"
                })
            }
            val account = root.optJSONObject("account") ?: error("استجابة التفعيل غير مكتملة")
            val credentials = root.optJSONObject("credentials") ?: error("بيانات الاشتراك غير مكتملة")
            // Fail closed if a proxy responds with a provider-controlled host.
            require(credentials.optString("serverUrl").trimEnd('/') == StreamCodeSession.HOST) {
                "خدمة التفعيل غير متوافقة"
            }
            val username = credentials.optString("username").trim()
            val password = credentials.optString("password")
            require(username.matches(Regex("[A-Za-z0-9_]{4,32}")) &&
                password.matches(Regex("[A-Za-z0-9_-]{8,64}"))) {
                "بيانات الاشتراك غير صالحة"
            }
            val activatedAt = account.optLong("activatedAt")
            val expiresAt = account.optLong("expiresAt")
            require(activatedAt > 0 && expiresAt > activatedAt) { "مدة الاشتراك غير صالحة" }
            Activated(username, password, activatedAt, expiresAt)
        }
    }
}
