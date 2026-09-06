package tv.blofy.player.core.cloud

import android.content.Context
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import tv.blofy.player.core.identity.DeviceIdentity
import tv.blofy.player.core.network.awaitResponse
import java.util.concurrent.TimeUnit

object ProfileCloudClient {
    data class RemoteSnapshot(
        val exists: Boolean,
        val revision: Long,
        val payload: JSONObject,
        val updatedAt: Long?,
    )

    sealed class SaveResult {
        data class Saved(val revision: Long, val payload: JSONObject) : SaveResult()
        data class Conflict(val revision: Long) : SaveResult()
    }

    private val json = "application/json; charset=utf-8".toMediaType()
    private val client = OkHttpClient.Builder()
        .connectTimeout(5, TimeUnit.SECONDS)
        .readTimeout(10, TimeUnit.SECONDS)
        .writeTimeout(10, TimeUnit.SECONDS)
        .callTimeout(15, TimeUnit.SECONDS)
        .build()

    suspend fun get(context: Context, baseUrl: String, profileId: String): RemoteSnapshot {
        val url = endpoint(baseUrl).toHttpUrl().newBuilder()
            .addQueryParameter("deviceId", DeviceIdentity.deviceId(context))
            .addQueryParameter("activationCode", DeviceIdentity.activationCode(context))
            .addQueryParameter("profileId", profileId)
            .build()
        val request = Request.Builder().url(url).get().build()
        client.newCall(request).awaitResponse().use { response ->
            val raw = response.body?.string().orEmpty()
            check(response.isSuccessful) { errorName(raw, "cloud_get_http_${response.code}") }
            val root = JSONObject(raw)
            return RemoteSnapshot(
                exists = root.optBoolean("exists", false),
                revision = root.optLong("revision", 0L),
                payload = root.optJSONObject("payload") ?: JSONObject(),
                updatedAt = if (root.has("updatedAt") && !root.isNull("updatedAt")) root.optLong("updatedAt") else null,
            )
        }
    }

    suspend fun put(
        context: Context,
        baseUrl: String,
        profileId: String,
        expectedRevision: Long,
        payload: JSONObject,
    ): SaveResult {
        val body = JSONObject().apply {
            put("deviceId", DeviceIdentity.deviceId(context))
            put("activationCode", DeviceIdentity.activationCode(context))
            put("profileId", profileId)
            put("expectedRevision", expectedRevision)
            put("payload", payload)
        }
        val request = Request.Builder()
            .url(endpoint(baseUrl))
            .put(body.toString().toRequestBody(json))
            .build()
        client.newCall(request).awaitResponse().use { response ->
            val raw = response.body?.string().orEmpty()
            if (response.code == 409) {
                val root = runCatching { JSONObject(raw) }.getOrDefault(JSONObject())
                return SaveResult.Conflict(root.optLong("revision", expectedRevision))
            }
            check(response.isSuccessful) { errorName(raw, "cloud_put_http_${response.code}") }
            val root = JSONObject(raw)
            return SaveResult.Saved(
                revision = root.optLong("revision", expectedRevision + 1L),
                payload = root.optJSONObject("payload") ?: payload,
            )
        }
    }

    private fun endpoint(baseUrl: String): String = baseUrl.trim().trimEnd('/') + "/api/v1/cloud/profile"

    private fun errorName(raw: String, fallback: String): String =
        runCatching { JSONObject(raw).optString("error") }.getOrNull()?.takeIf(String::isNotBlank) ?: fallback
}
