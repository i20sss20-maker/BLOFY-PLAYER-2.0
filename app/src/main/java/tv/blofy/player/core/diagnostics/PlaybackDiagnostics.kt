package tv.blofy.player.core.diagnostics

import android.os.SystemClock
import android.util.Log

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
    private const val MAX_HISTORY = 100
    private val history = ArrayList<PlaybackMetric>(MAX_HISTORY)

    fun begin(providerKey: String, kind: String, url: String): PlaybackMetric {
        val metric = PlaybackMetric(
            providerKey = DiagnosticsSanitizer.pseudonymizeProviderKey(providerKey),
            contentKind = DiagnosticsSanitizer.sanitizeContentKind(kind),
            url = DiagnosticsSanitizer.sanitizeUrl(url),
            startedAtElapsedMs = SystemClock.elapsedRealtime()
        )
        synchronized(history) {
            if (history.size == MAX_HISTORY) history.removeAt(0)
            history += metric
        }
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

    fun snapshot(): List<PlaybackMetric> = synchronized(history) { history.toList() }

    fun clear() = synchronized(history) { history.clear() }

    private fun replace(old: PlaybackMetric, new: PlaybackMetric) {
        synchronized(history) {
            val index = history.indexOf(old)
            // Late events must not resurrect an evicted or explicitly cleared session.
            if (index >= 0) history[index] = new
        }
    }
}
