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
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.ThreadPoolExecutor
import java.util.concurrent.TimeUnit

object PlaybackDiagnosticsUploader {
    private const val TAG = "BLOFY_DIAG_UPLOAD"
    // Telemetry is best-effort: a slow network must not retain an unbounded queue
    // or run uploads on the caller (which can be the player/UI thread).
    private val executor = createUploadExecutor()
    internal fun createUploadExecutor() = ThreadPoolExecutor(
        1, 1, 0L, TimeUnit.MILLISECONDS, ArrayBlockingQueue<Runnable>(16),
        ThreadPoolExecutor.DiscardOldestPolicy()
    )
    // Activation credentials must never follow redirects to another endpoint.
    private val client = OkHttpClient.Builder()
        .followRedirects(false)
        .followSslRedirects(false)
        .callTimeout(8, TimeUnit.SECONDS)
        .connectTimeout(4, TimeUnit.SECONDS)
        .readTimeout(6, TimeUnit.SECONDS)
        .writeTimeout(6, TimeUnit.SECONDS)
        .build()
    private val jsonMediaType = "application/json; charset=utf-8".toMediaType()

    fun enqueue(context: Context, metric: PlaybackMetric) {
        if (!tv.blofy.player.core.privacy.PrivacyPreferences.diagnosticsEnabled(context)) return
        val baseUrl = BuildConfig.ACTIVATION_BASE_URL.trim().trimEnd('/')
        if (baseUrl.isBlank()) return
        val appContext = context.applicationContext
        executor.execute {
            if (!tv.blofy.player.core.privacy.PrivacyPreferences.diagnosticsEnabled(appContext)) return@execute
            runCatching {
                val payload = JSONObject().apply {
                    put("deviceId", DeviceIdentity.deviceId(appContext))
                    put("activationCode", DeviceIdentity.activationCode(appContext))
                    put("providerKey", DiagnosticsSanitizer.pseudonymizeProviderKey(metric.providerKey))
                    put("contentKind", DiagnosticsSanitizer.sanitizeContentKind(metric.contentKind))
                    put("redactedUrl", DiagnosticsSanitizer.sanitizeUrl(metric.url, 1024))
                    metric.ttffMs?.let { put("ttffMs", it) }
                    put("bufferingCount", metric.bufferingCount)
                    DiagnosticsSanitizer.sanitizeErrorCode(metric.errorCode)?.let { put("errorCode", it) }
                    DiagnosticsSanitizer.sanitizeMessage(metric.errorMessage, 512)
                        ?.let { put("errorMessage", it) }
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
