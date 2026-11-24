package tv.blofy.player.core.identity

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import tv.blofy.player.core.network.awaitResponse
import java.util.concurrent.TimeUnit

/**
 * Separate Connect contract. Do not send external pairing codes to legacy
 * paid voucher redemption. Not wired to production login until encrypted
 * external-profile persistence and catalog/playback routes are audited.
 */
object ExternalStreamConnectClient {
    private val codePattern = Regex("BC-[A-Za-z0-9_-]{24}")
    private val jsonType = "application/json; charset=utf-8".toMediaType()
    private val client = OkHttpClient.Builder()
        .connectTimeout(8, TimeUnit.SECONDS)
        .readTimeout(15, TimeUnit.SECONDS)
        .callTimeout(20, TimeUnit.SECONDS)
        .followRedirects(false)
        .followSslRedirects(false)
        .retryOnConnectionFailure(false)
        .build()

    // Not a data class: default toString must not expose the credentials.
    class Credentials(val host: HttpUrl, val username: String, val password: String)

    fun normalizeCode(value: String): String? =
        value.trim().takeIf { codePattern.matches(it) }

    fun parseHost(value: String): HttpUrl? {
        val url = value.toHttpUrlOrNull() ?: return null
        val host = url.host
        if (!url.isHttps || url.username.isNotEmpty() || url.password.isNotEmpty() ||
            url.encodedPath != "/" || url.query != null || url.fragment != null ||
            !host.contains('.') || host.endsWith('.') || host.contains(':') ||
            host.matches(Regex("[0-9.]+")) ||
            host.substringAfterLast('.') in setOf("localhost","local","internal","lan","home","test","invalid","example","onion")
        ) return null
        return url
    }

    suspend fun redeem(rawCode: String): Credentials = withContext(Dispatchers.IO) {
        val code = normalizeCode(rawCode) ?: error("كود CONNECT غير صحيح")
        val request = Request.Builder()
            .url("https://blofyplayer.com/api/v1/stream/connect/redeem")
            .post(JSONObject().put("code", code).toString().toRequestBody(jsonType))
            .header("Accept", "application/json")
            .header("Cache-Control", "no-store")
            .build()
        client.newCall(request).awaitResponse().use { response ->
            if (!response.isSuccessful) error(when (response.code) {
                404 -> "انتهت صلاحية كود الربط أو استُخدم. أنشئ كودًا جديدًا"
                429 -> "محاولات كثيرة، أعد المحاولة لاحقًا"
                503 -> "خدمة CONNECT غير متاحة حاليًا"
                else -> "تعذر ربط اشتراك CONNECT"
            })
            val body = response.body ?: error("استجابة الربط غير مكتملة")
            val source = body.source()
            source.request(8193)
            if (source.buffer.size > 8192) error("استجابة الربط غير صالحة")
            val root = runCatching { JSONObject(source.readUtf8()) }
                .getOrElse { error("استجابة الربط غير صالحة") }
            if (!root.optBoolean("ok") || root.optString("type") != "external_xtream" ||
                root.optBoolean("providerVerified", true)) error("استجابة الربط غير صالحة")
            val c = root.optJSONObject("credentials") ?: error("استجابة الربط غير مكتملة")
            val host = parseHost(c.optString("host")) ?: error("عنوان المزود غير صالح")
            val username = c.optString("username")
            val password = c.optString("password")
            require(username.length in 1..256 && password.length in 1..256 &&
                (username + password).none { it.code < 32 || it.code == 127 }) {
                "بيانات المزود غير صالحة"
            }
            Credentials(host, username, password)
        }
    }
}
