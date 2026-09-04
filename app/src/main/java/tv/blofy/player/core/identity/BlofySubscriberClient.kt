package tv.blofy.player.core.identity

import android.content.Context
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import tv.blofy.player.core.network.awaitResponse
import java.util.concurrent.TimeUnit

object BlofySubscriberClient {
    data class Session(
        val providerName: String,
        val baseUrl: String,
        val username: String,
        val password: String,
        val expiresAt: Long
    )

    private val client = OkHttpClient.Builder()
        .callTimeout(18, TimeUnit.SECONDS)
        .connectTimeout(6, TimeUnit.SECONDS)
        .readTimeout(15, TimeUnit.SECONDS)
        .writeTimeout(8, TimeUnit.SECONDS)
        .build()
    private val jsonType = "application/json; charset=utf-8".toMediaType()

    suspend fun createSession(
        context: Context,
        activationBaseUrl: String,
        username: String,
        password: String
    ): Session = withContext(Dispatchers.IO) {
        val endpoint = activationBaseUrl.trim().trimEnd('/')
        require(endpoint.startsWith("https://", true) || endpoint.startsWith("http://", true)) {
            "خدمة BLOFY غير مهيأة"
        }
        verifyServiceReady(endpoint)

        val body = JSONObject().apply {
            put("deviceId", DeviceIdentity.deviceId(context))
            put("activationCode", DeviceIdentity.activationCode(context))
            put("username", username.trim())
            put("password", password)
        }
        val request = Request.Builder()
            .url("$endpoint/api/v1/subscribers/session")
            .post(body.toString().toRequestBody(jsonType))
            .build()
        client.newCall(request).awaitResponse().use { response ->
            val text = response.body?.string().orEmpty()
            val root = runCatching { JSONObject(text) }.getOrElse { JSONObject() }
            if (!response.isSuccessful) {
                val message = when (root.optString("error")) {
                    "invalid_subscriber_credentials" -> "أدخل اسم المستخدم وكلمة المرور بشكل صحيح"
                    "subscriber_login_failed" -> "اسم المستخدم أو كلمة المرور غير صحيحة"
                    "unauthorized_device" -> "يجب تفعيل جهاز BLOFY أولًا"
                    "subscriber_service_unavailable" -> "خدمة مشتركين BLOFY غير جاهزة"
                    "subscriber_upstream_unavailable" -> "تعذر الوصول إلى سيرفر الاشتراك"
                    "subscriber_proxy_error" -> "حدث خطأ في بوابة BLOFY الآمنة"
                    else -> "تعذر تسجيل الدخول إلى مشتركين BLOFY"
                }
                error(message)
            }
            val baseUrl = root.optString("baseUrl").trim().trimEnd('/')
            val proxyUser = root.optString("username").trim()
            val proxyPassword = root.optString("password")
            require(baseUrl.isNotBlank() && proxyUser.isNotBlank()) { "استجابة BLOFY غير مكتملة" }
            require(baseUrl.startsWith("$endpoint/api/v1/subscribers/xtream", ignoreCase = true)) {
                "استجابة BLOFY غير آمنة"
            }
            Session(
                providerName = root.optString("providerName").ifBlank { "مشتركين BLOFY" },
                baseUrl = baseUrl,
                username = proxyUser,
                password = proxyPassword.ifBlank { "blofy" },
                expiresAt = root.optLong("expiresAt")
            )
        }
    }

    private suspend fun verifyServiceReady(endpoint: String) {
        val request = Request.Builder()
            .url("$endpoint/api/v1/subscribers/health")
            .get()
            .build()
        client.newCall(request).awaitResponse().use { response ->
            val root = runCatching { JSONObject(response.body?.string().orEmpty()) }.getOrElse { JSONObject() }
            if (response.isSuccessful && root.optBoolean("ok")) return

            val reason = when {
                !root.optBoolean("hostConfigured", true) -> "الهوست المخفي لمشتركين BLOFY غير مهيأ"
                !root.optBoolean("encryptionReady", true) -> "تشفير مشتركين BLOFY غير جاهز"
                !root.optBoolean("databaseReady", true) -> "قاعدة بيانات مشتركين BLOFY غير جاهزة"
                else -> "خدمة مشتركين BLOFY غير متاحة الآن"
            }
            error(reason)
        }
    }
}
