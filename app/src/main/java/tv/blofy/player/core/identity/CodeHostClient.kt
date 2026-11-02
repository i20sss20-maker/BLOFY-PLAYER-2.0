package tv.blofy.player.core.identity

import android.content.Context
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import tv.blofy.player.BuildConfig
import tv.blofy.player.core.network.awaitResponse
import tv.blofy.player.core.url.PlaylistUrlPolicy
import tv.blofy.player.data.local.ProviderEntity
import java.net.URI
import java.util.concurrent.TimeUnit

/**
 * Code-only edition adapter. The configured HTTPS gateway resolves an access code to an
 * authorized provider profile. The gateway, NOT the Android client, owns code validation,
 * expiration, revocation, device limits and private upstream credentials.
 *
 * This is an integration contract, not proof that a particular upstream host implements it.
 * Configure only after the user's actual host/API has been inspected.
 */
object CodeHostClient {
    private val json = "application/json; charset=utf-8".toMediaType()
    private val client = OkHttpClient.Builder()
        .connectTimeout(6, TimeUnit.SECONDS)
        .callTimeout(20, TimeUnit.SECONDS)
        .readTimeout(15, TimeUnit.SECONDS)
        .build()

    suspend fun login(context: Context, gatewayUrl: String, code: String): ProviderEntity =
        withContext(Dispatchers.IO) {
            val endpoint = gatewayUrl.trim().trimEnd('/')
            val uri = runCatching { URI(endpoint) }.getOrNull()
            require(uri?.scheme.equals("https", true) && !uri?.host.isNullOrBlank() &&
                uri?.userInfo == null && uri?.query == null && uri?.fragment == null) {
                "هوست التفعيل يجب أن يكون HTTPS صالحاً"
            }
            val value = code.trim()
            require(value.length in 4..64 && value.matches(Regex("[A-Za-z0-9_-]+"))) {
                "أدخل كوداً صحيحاً"
            }
            val payload = JSONObject()
                .put("code", value)
                .put("deviceId", DeviceIdentity.deviceId(context))
                .put("appVersion", BuildConfig.VERSION_NAME)
            val request = Request.Builder()
                .url(endpoint + "/api/v1/code-login")
                .post(payload.toString().toRequestBody(json))
                .build()

            client.newCall(request).awaitResponse().use { response ->
                val result = runCatching { JSONObject(response.body?.string().orEmpty()) }
                    .getOrDefault(JSONObject())
                if (!response.isSuccessful) {
                    error(when (response.code) {
                        401, 403 -> "الكود غير صحيح أو لم يعد صالحاً"
                        404 -> "مسار دخول الأكواد غير متوفر على الهوست"
                        409 -> "الكود مستخدم على جهاز آخر"
                        410 -> "انتهت صلاحية الكود"
                        429 -> "محاولات كثيرة، حاول لاحقاً"
                        else -> "تعذر الاتصال بخدمة الأكواد"
                    })
                }
                val profile = result.optJSONObject("provider")
                    ?: error("استجابة الهوست لا تحتوي بيانات الربط")
                val providerType = profile.optString("providerType", "xtream").lowercase()
                val url = profile.optString("baseUrl").trim().trimEnd('/')
                val username = profile.optString("username").trim()
                val password = profile.optString("password")
                require(providerType == "xtream" || providerType == "m3u") {
                    "نوع المصدر غير مدعوم"
                }
                require(PlaylistUrlPolicy.isValid(url) &&
                    (providerType != "xtream" || (username.isNotBlank() && password.isNotBlank()))) {
                    "بيانات الربط المستلمة من الهوست غير مكتملة"
                }
                ProviderEntity(
                    id = "code-only-provider",
                    name = profile.optString("name").ifBlank { "BLOFY" },
                    baseUrl = url,
                    username = username,
                    password = password,
                    providerType = providerType,
                    enabled = true,
                    updatedAt = System.currentTimeMillis()
                )
            }
        }
}
