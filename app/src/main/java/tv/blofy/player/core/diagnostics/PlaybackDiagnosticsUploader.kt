package tv.blofy.player.core.diagnostics

import android.content.Context
import android.util.Log
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import tv.blofy.player.BuildConfig
import tv.blofy.player.core.identity.DeviceIdentity
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

object PlaybackDiagnosticsUploader {
    private const val TAG = "BLOFY_DIAG_UPLOAD"
    private val executor = Executors.newSingleThreadExecutor()
    private val client = OkHttpClient.Builder()
        .connectTimeout(4, TimeUnit.SECONDS)
        .readTimeout(6, TimeUnit.SECONDS)
        .writeTimeout(6, TimeUnit.SECONDS)
        .build()
    private val jsonMediaType = "application/json; charset=utf-8".toMediaType()

    fun enqueue(context: Context, metric: PlaybackMetric) {
        val baseUrl = BuildConfig.ACTIVATION_BASE_URL.trim().trimEnd('/')
        if (baseUrl.isBlank()) return
        val appContext = context.applicationContext
        executor.execute {
            runCatching {
                val payload = JSONObject().apply {
                    put("deviceId", DeviceIdentity.deviceId(appContext))
                    put("activationCode", DeviceIdentity.activationCode(appContext))
                    put("providerKey", metric.providerKey.take(128))
                    put("contentKind", metric.contentKind.take(32))
                    put("redactedUrl", metric.url.take(1024))
                    metric.ttffMs?.let { put("ttffMs", it) }
                    put("bufferingCount", metric.bufferingCount)
                    metric.errorCode?.let { put("errorCode", it.take(128)) }
                    metric.errorMessage?.let { put("errorMessage", it.take(512)) }
                    put("appVersion", BuildConfig.VERSION_NAME)
                }
                val request = Request.Builder()
                    .url("$baseUrl/api/v1/diagnostics/playback")
                    .post(payload.toString().toRequestBody(jsonMediaType))
                    .build()
                client.newCall(request).execute().use { response ->
                    if (!response.isSuccessful) Log.w(TAG, "diagnostic upload HTTP ${response.code}")
                }
            }.onFailure { Log.w(TAG, "diagnostic upload skipped: ${it.javaClass.simpleName}") }
        }
    }
}
