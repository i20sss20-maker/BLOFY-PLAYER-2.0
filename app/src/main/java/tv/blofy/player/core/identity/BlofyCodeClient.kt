package tv.blofy.player.core.identity

import android.content.Context
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import org.json.JSONObject
import tv.blofy.player.BuildConfig
import tv.blofy.player.core.network.awaitResponse
import tv.blofy.player.core.url.PlaylistUrlPolicy
import java.util.UUID
import java.util.concurrent.TimeUnit

/**
 * Dedicated code-only login. Talks only to the HTTPS BLOFY activation API,
 * never to old STROING 8K login, and never submits a code directly to Xtream.
 * The backend maps a redeemed code to annkel.com Xtream credentials.
 */
object BlofyCodeClient {
    data class Account(
        val id: String,
        val name: String,
        val baseUrl: String,
        val username: String,
        val password: String
    )

    private val client = OkHttpClient.Builder()
        .callTimeout(20, TimeUnit.SECONDS)
        .connectTimeout(6, TimeUnit.SECONDS)
        .readTimeout(14, TimeUnit.SECONDS)
        .followRedirects(false)
        .followSslRedirects(false)
        .build()
    private val jsonType = "application/json; charset=utf-8".toMediaType()

    internal fun parseAccount(root: JSONObject): Account {
        require(root.optString("delivery") == "direct") { "invalid_response" }
        val raw = root.optString("baseUrl").trim().trimEnd('/')
        val url = raw.toHttpUrlOrNull()
        // Owner-supplied code host ONLY; never accept arbitrary hosts from a code response.
        require(
            url != null && url.scheme == "http" && url.host.equals("annkel.com", true) &&
                url.port == 80 && url.encodedPath.trimEnd('/').isEmpty() &&
                url.query == null && url.fragment == null &&
                url.encodedUsername.isEmpty() && url.encodedPassword.isEmpty() &&
                PlaylistUrlPolicy.isValid(raw)
        ) { "unexpected_code_host" }
        val id = root.optString("providerId")
        require(runCatching { UUID.fromString(id) }.isSuccess) { "invalid_provider_id" }
        val username = root.optString("username")
        val password = root.optString("password")
        require(username.isNotBlank() && password.isNotBlank()) { "missing_provider_credentials" }
        return Account(id, "BLOFY", raw, username, password)
    }

    suspend fun redeem(context: Context, code: String): Account = withContext(Dispatchers.IO) {
        val normalized = code.trim().uppercase(java.util.Locale.ROOT)
        require(normalized.matches(Regex("[A-Z0-9-]{8,32}"))) { "invalid_code" }
        val endpoint = BlofySubscriberClient.serviceEndpoint(BuildConfig.ACTIVATION_BASE_URL)
        val identity = BlofySubscriberClient.sessionIdentity(
            context, ActivationRemoteClient.create(endpoint), BuildConfig.VERSION_NAME
        )
        val requestBody = JSONObject().apply {
            put("deviceId", identity.deviceId)
            put("activationCode", identity.activationCode)
            put("code", normalized)
        }
        val request = Request.Builder().url("$endpoint/api/v1/blofy-codes/redeem")
            .post(requestBody.toString().toRequestBody(jsonType)).build()
        client.newCall(request).awaitResponse().use { response ->
            if (!response.isSuccessful) {
                val reason = runCatching { JSONObject(response.body?.string().orEmpty()).optString("error") }
                    .getOrDefault("")
                error(when (reason) {
                    "code_unavailable" -> "code_unavailable"
                    "invalid_code" -> "invalid_code"
                    "device_not_active" -> "device_not_active"
                    "rate_limited" -> "rate_limited"
                    else -> "code_connection_error"
                })
            }
            parseAccount(JSONObject(response.body?.string().orEmpty()))
        }
    }
}
