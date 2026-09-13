package tv.blofy.player.core.identity

import android.content.Context
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import tv.blofy.player.BuildConfig
import tv.blofy.player.core.network.awaitResponse
import java.io.IOException
import java.util.concurrent.TimeUnit

object AccountClient {
    class Failure(val code: String) : IOException(code)
    private val client = OkHttpClient.Builder().followRedirects(false).followSslRedirects(false)
        .connectTimeout(5, TimeUnit.SECONDS).callTimeout(15, TimeUnit.SECONDS).build()
    private val json = "application/json; charset=utf-8".toMediaType()

    suspend fun post(context: Context, path: String, fields: JSONObject = JSONObject(), baseUrl: String = BuildConfig.ACTIVATION_BASE_URL): JSONObject {
        require(path in setOf("/api/v1/license/recovery/create", "/api/v1/license/recovery/restore",
            "/api/v1/device/sessions/revoke", "/api/v1/privacy/delete"))
        val body = JSONObject(fields.toString()).apply {
            put("deviceId", DeviceIdentity.deviceId(context))
            put("activationCode", DeviceIdentity.activationCode(context))
        }
        val request = Request.Builder().url(baseUrl.trim().trimEnd('/') + path)
            .post(body.toString().toRequestBody(json)).build()
        client.newCall(request).awaitResponse().use { response ->
            val payload = runCatching { JSONObject(response.body?.string().orEmpty()) }.getOrDefault(JSONObject())
            if (!response.isSuccessful) throw Failure(payload.optString("error", "request_failed"))
            return payload
        }
    }
}
