package tv.blofy.player.core.diagnostics

import android.os.SystemClock
import android.util.Log
import java.util.concurrent.CopyOnWriteArrayList

data class PlaybackMetric(
    val providerKey: String,
    val contentKind: String,
    val url: String,
    val startedAtElapsedMs: Long,
    val firstFrameElapsedMs: Long? = null,
    val bufferingCount: Int = 0,
    val errorCode: String? = null,
    val errorMessage: String? = null
) {
    val ttffMs: Long?
        get() = firstFrameElapsedMs?.let { it - startedAtElapsedMs }
}

object PlaybackDiagnostics {
    private const val TAG = "BLOFY_DIAG"
    private val history = CopyOnWriteArrayList<PlaybackMetric>()

    fun begin(providerKey: String, kind: String, url: String): PlaybackMetric {
        val metric = PlaybackMetric(
            providerKey = DiagnosticsSanitizer.pseudonymizeProviderKey(providerKey),
            contentKind = DiagnosticsSanitizer.sanitizeContentKind(kind),
            url = DiagnosticsSanitizer.sanitizeUrl(url),
            startedAtElapsedMs = SystemClock.elapsedRealtime()
        )
        history += metric
        Log.i(TAG, "begin provider=${metric.providerKey} kind=${metric.contentKind} url=${metric.url}")
        return metric
    }

    fun firstFrame(metric: PlaybackMetric): PlaybackMetric {
        val updated = metric.copy(firstFrameElapsedMs = SystemClock.elapsedRealtime())
        replace(metric, updated)
        Log.i(TAG, "first_frame provider=${metric.providerKey} kind=${metric.contentKind} ttff=${updated.ttffMs}ms")
        return updated
    }

    fun buffering(metric: PlaybackMetric): PlaybackMetric {
        val updated = metric.copy(bufferingCount = metric.bufferingCount + 1)
        replace(metric, updated)
        Log.i(TAG, "buffering provider=${metric.providerKey} kind=${metric.contentKind} count=${updated.bufferingCount}")
        return updated
    }

    fun error(metric: PlaybackMetric, code: String?, message: String?): PlaybackMetric {
        val safeCode = DiagnosticsSanitizer.sanitizeErrorCode(code)
        val safeMessage = DiagnosticsSanitizer.sanitizeMessage(message)
        val updated = metric.copy(errorCode = safeCode, errorMessage = safeMessage)
        replace(metric, updated)
        Log.e(TAG, "error provider=${metric.providerKey} kind=${metric.contentKind} code=$safeCode message=$safeMessage")
        return updated
    }

    fun snapshot(): List<PlaybackMetric> = history.takeLast(100)

    fun clear() = history.clear()

    private fun replace(old: PlaybackMetric, new: PlaybackMetric) {
        val index = history.indexOf(old)
        if (index >= 0) history[index] = new else history += new
    }
}
