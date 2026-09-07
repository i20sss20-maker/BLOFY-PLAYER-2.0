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

    data class PairCode(
        val code: String,
        val expiresAt: Long,
        val ttlMinutes: Int,
    )

    data class PairRestore(
        val revision: Long,
        val payload: JSONObject,
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
        val deviceId = DeviceIdentity.deviceId(context)
        val activationCode = DeviceIdentity.activationCode(context)
        val url = endpoint(baseUrl).toHttpUrl().newBuilder()
            .addQueryParameter("profileId", profileId)
            .build()
        val request = Request.Builder()
            .url(url)
            .header("X-BLOFY-Device-ID", deviceId)
            .header("X-BLOFY-Activation-Code", activationCode)
            .get()
            .build()
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
        val body = authenticatedBody(context).apply {
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

    suspend fun createPairCode(context: Context, baseUrl: String, profileId: String): PairCode {
        val body = authenticatedBody(context).apply { put("profileId", profileId) }
        val request = Request.Builder()
            .url(endpoint(baseUrl) + "/pair/create")
            .post(body.toString().toRequestBody(json))
            .build()
        client.newCall(request).awaitResponse().use { response ->
            val raw = response.body?.string().orEmpty()
            check(response.code == 201) { errorName(raw, "cloud_pair_create_http_${response.code}") }
            val root = JSONObject(raw)
            return PairCode(
                code = root.getString("pairCode"),
                expiresAt = root.optLong("expiresAt"),
                ttlMinutes = root.optInt("ttlMinutes", 10),
            )
        }
    }

    suspend fun restorePairCode(context: Context, baseUrl: String, profileId: String, pairCode: String): PairRestore {
        val body = authenticatedBody(context).apply {
            put("profileId", profileId)
            put("pairCode", pairCode.trim().uppercase())
        }
        val request = Request.Builder()
            .url(endpoint(baseUrl) + "/pair/restore")
            .post(body.toString().toRequestBody(json))
            .build()
        client.newCall(request).awaitResponse().use { response ->
            val raw = response.body?.string().orEmpty()
            check(response.isSuccessful) { errorName(raw, "cloud_pair_restore_http_${response.code}") }
            val root = JSONObject(raw)
            return PairRestore(
                revision = root.optLong("revision", 1L),
                payload = root.optJSONObject("payload") ?: JSONObject(),
            )
        }
    }

    private fun authenticatedBody(context: Context) = JSONObject().apply {
        put("deviceId", DeviceIdentity.deviceId(context))
        put("activationCode", DeviceIdentity.activationCode(context))
    }

    private fun endpoint(baseUrl: String): String = baseUrl.trim().trimEnd('/') + "/api/v1/cloud/profile"

    private fun errorName(raw: String, fallback: String): String =
        runCatching { JSONObject(raw).optString("error") }.getOrNull()?.takeIf(String::isNotBlank) ?: fallback
}
