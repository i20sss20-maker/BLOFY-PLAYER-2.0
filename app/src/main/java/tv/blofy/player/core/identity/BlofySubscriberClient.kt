package tv.blofy.player.core.identity

import android.content.Context
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import org.json.JSONArray
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import tv.blofy.player.core.network.awaitResponse
import tv.blofy.player.core.url.PlaylistUrlPolicy
import tv.blofy.player.data.local.ProviderEntity
import tv.blofy.player.data.local.BlofyDatabase
import tv.blofy.player.data.local.ActivationEntity
import tv.blofy.player.BuildConfig
import java.util.concurrent.TimeUnit

object BlofySubscriberClient {
    data class Session(
        val providerName: String,
        val baseUrl: String,
        val username: String,
        val password: String,
        val expiresAt: Long,
        val providerId: String = "",
        val sessionToken: String = ""
    )

    private val client = OkHttpClient.Builder()
        .callTimeout(18, TimeUnit.SECONDS)
        .connectTimeout(6, TimeUnit.SECONDS)
        .readTimeout(15, TimeUnit.SECONDS)
        .writeTimeout(8, TimeUnit.SECONDS)
        .followRedirects(false)
        .followSslRedirects(false)
        .build()
    private val jsonType = "application/json; charset=utf-8".toMediaType()

    suspend fun createSession(
        context: Context,
        activationBaseUrl: String,
        username: String,
        password: String
    ): Session = withContext(Dispatchers.IO) {
        val endpoint = serviceEndpoint(activationBaseUrl)
        verifyServiceReady(endpoint)
        val identity = sessionIdentity(context, ActivationRemoteClient.create(endpoint), BuildConfig.VERSION_NAME)

        val body = JSONObject().apply {
            put("deviceId", identity.deviceId)
            put("activationCode", identity.activationCode)
            put("username", username.trim())
            put("password", password)
            put("delivery", "direct")
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
            parseDirectSession(root)
        }
    }

    /** The registration form is reachable before a new installation has checked in. */
    internal suspend fun sessionIdentity(context: Context, api: ActivationApi, appVersion: String): ActivationEntity {
        val manager = ActivationManager(context, BlofyDatabase.get(context).dao())
        val current = manager.ensureIdentity()
        if (manager.cachedCanUse(current)) return current
        val checked = manager.refresh(api, appVersion)
        check(checked.canUse()) { "يجب تفعيل جهاز BLOFY أولًا" }
        // A successful check may also rotate a pending pairing code. Use the committed identity.
        return manager.ensureIdentity()
    }

    internal fun serviceEndpoint(value: String): String {
        val endpoint = value.trim().trimEnd('/')
        val url = endpoint.toHttpUrlOrNull()
        require(url != null && url.isHttps && url.encodedUsername.isEmpty() && url.encodedPassword.isEmpty() &&
            url.query == null && url.fragment == null) { "خدمة BLOFY غير مهيأة" }
        return endpoint
    }

    internal fun parseDirectSession(root: JSONObject): Session {
        check(root.optString("delivery") == "direct") { "خدمة BLOFY تحتاج تحديث الاتصال المباشر" }
        val baseUrl = root.optString("baseUrl").trim().trimEnd('/')
        val url = baseUrl.toHttpUrlOrNull()
        val username = root.optString("username")
        val password = root.optString("password")
        val token = root.optString("sessionToken")
        check(PlaylistUrlPolicy.isValid(baseUrl) && url?.query == null && url?.fragment == null &&
            !isProxyPath(baseUrl) && username.isNotBlank() && password.isNotBlank() &&
            token.length in 1..4096 && token.all { it.isLetterOrDigit() && it.code < 128 || it == '-' || it == '_' }) {
            "استجابة BLOFY غير مكتملة"
        }
        return Session(root.optString("providerName").ifBlank { "مشتركين BLOFY" }, baseUrl, username, password,
            root.optLong("expiresAt"), root.optString("providerId").takeIf {
                runCatching { java.util.UUID.fromString(it) }.isSuccess
            }.orEmpty(), token)
    }

    internal fun isProxyPath(value: String): Boolean =
        value.toHttpUrlOrNull()?.encodedPath?.trimEnd('/') == "/api/v1/subscribers/xtream"

    internal fun isLegacyProxy(provider: ProviderEntity, endpoint: String): Boolean {
        val base = endpoint.trim().trimEnd('/').toHttpUrlOrNull() ?: return false
        val url = provider.baseUrl.toHttpUrlOrNull() ?: return false
        return provider.providerType.equals("xtream", true) && provider.subscriberToken.isBlank() &&
            url.scheme == base.scheme && url.host == base.host && url.port == base.port &&
            url.encodedPath.trimEnd('/') == base.encodedPath.trimEnd('/') + "/api/v1/subscribers/xtream" &&
            url.query == null && url.fragment == null && url.encodedUsername.isEmpty() && url.encodedPassword.isEmpty()
    }

    fun isManaged(provider: ProviderEntity): Boolean = provider.subscriberToken.isNotBlank() || isProxyPath(provider.baseUrl)

    internal fun portalSource(provider: ProviderEntity, endpoint: String): ProviderEntity =
        if (provider.subscriberToken.isBlank()) provider else provider.copy(
            baseUrl = serviceEndpoint(endpoint) + "/api/v1/subscribers/xtream",
            username = provider.subscriberToken, password = "blofy"
        )

    internal suspend fun resolveConnections(context: Context, baseUrl: String, tokens: Collection<String>): Map<String, Session> = withContext(Dispatchers.IO) {
        if (tokens.isEmpty()) return@withContext emptyMap()
        val endpoint = serviceEndpoint(baseUrl)
        val resolved = linkedMapOf<String, Session>()
        // Malformed legacy tokens are deferred instead of poisoning the batch.
        for (batch in tokens.filter { it.length in 1..4096 && it.all { c ->
            c.code < 128 && (c.isLetterOrDigit() || c == '-' || c == '_')
        } }.distinct().chunked(20)) {
            val body = JSONObject().apply {
                put("deviceId", DeviceIdentity.deviceId(context))
                put("activationCode", DeviceIdentity.activationCode(context))
                put("sessionTokens", JSONArray(batch))
            }
            val request = Request.Builder().url("$endpoint/api/v1/subscribers/resolve")
                .post(body.toString().toRequestBody(jsonType)).build()
            client.newCall(request).awaitResponse().use { response ->
                if (!response.isSuccessful) throw PortalRefreshFailure("SUB", response.code)
                val items = JSONObject(response.body?.string().orEmpty()).optJSONArray("items")
                check(items != null) { "استجابة BLOFY غير مكتملة" }
                for (index in 0 until items.length()) {
                    val row = items.optJSONObject(index) ?: continue
                    val token = row.optString("sessionToken")
                    if (token !in batch) continue
                    if (row.has("error")) continue
                    // Keep valid accounts when another account response is incomplete.
                    runCatching { parseDirectSession(row) }.getOrNull()?.let { resolved[token] = it }
                }
            }
        }
        resolved
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
