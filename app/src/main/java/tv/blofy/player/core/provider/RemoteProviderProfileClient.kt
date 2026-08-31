package tv.blofy.player.core.provider

import android.content.Context
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import tv.blofy.player.core.identity.DeviceIdentity
import tv.blofy.player.data.local.ProviderEntity
import java.util.concurrent.TimeUnit

object RemoteProviderProfileClient {
    private val client = OkHttpClient.Builder()
        .connectTimeout(4, TimeUnit.SECONDS)
        .readTimeout(6, TimeUnit.SECONDS)
        .writeTimeout(6, TimeUnit.SECONDS)
        .build()
    private val jsonType = "application/json; charset=utf-8".toMediaType()

    suspend fun applyIfAvailable(context: Context, baseUrl: String, provider: ProviderEntity): ProviderEntity = withContext(Dispatchers.IO) {
        val endpoint = baseUrl.trim().trimEnd('/')
        if (endpoint.isBlank()) return@withContext provider

        runCatching {
            val body = JSONObject().apply {
                put("deviceId", DeviceIdentity.deviceId(context))
                put("activationCode", DeviceIdentity.activationCode(context))
                put("providerKey", provider.id)
            }
            val request = Request.Builder()
                .url("$endpoint/api/v1/provider-profile")
                .post(body.toString().toRequestBody(jsonType))
                .build()
            client.newCall(request).execute().use { response ->
                if (!response.isSuccessful) return@use provider
                val json = JSONObject(response.body?.string().orEmpty())
                provider.copy(
                    liveFormat = json.optString("liveFormat").takeIf { it == "ts" || it == "m3u8" } ?: provider.liveFormat,
                    preferredTransport = json.optString("preferredTransport").takeIf { it == "cronet" || it == "http" } ?: provider.preferredTransport,
                    preferredEngine = json.optString("preferredEngine").takeIf { it == "media3" || it == "vlc" } ?: provider.preferredEngine,
                    allowCrossProtocolRedirects = if (json.has("allowCrossProtocolRedirects")) json.optBoolean("allowCrossProtocolRedirects") else provider.allowCrossProtocolRedirects,
                    updatedAt = System.currentTimeMillis()
                )
            }
        }.getOrDefault(provider)
    }
}
