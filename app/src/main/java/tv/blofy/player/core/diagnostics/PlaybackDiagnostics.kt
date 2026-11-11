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
    val rebufferCount: Int = 0,
    val rebufferDurationMs: Long = 0,
    val bufferStartedAtElapsedMs: Long? = null,
    val recoveryCount: Int = 0,
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
        if (metric.bufferStartedAtElapsedMs != null) return metric
        val updated = metric.copy(
            bufferingCount = metric.bufferingCount + 1,
            rebufferCount = metric.rebufferCount +
                if (metric.firstFrameElapsedMs != null) 1 else 0,
            bufferStartedAtElapsedMs = SystemClock.elapsedRealtime()
        )
        replace(metric, updated)
        Log.i(TAG, "buffering kind=${metric.contentKind} count=${updated.bufferingCount}")
        return updated
    }

    /** Finalize buffer intervals only after a first frame. Initial loading is
     * measured by TTFF, not double counted as an interruption.
     */
    fun ready(metric: PlaybackMetric): PlaybackMetric = closeBuffer(metric, SystemClock.elapsedRealtime())

    fun recovered(metric: PlaybackMetric): PlaybackMetric {
        val updated = metric.copy(recoveryCount = (metric.recoveryCount + 1).coerceAtMost(1000))
        replace(metric, updated)
        return updated
    }

    fun finish(metric: PlaybackMetric): PlaybackMetric = closeBuffer(metric, SystemClock.elapsedRealtime())

    private fun closeBuffer(metric: PlaybackMetric, now: Long): PlaybackMetric {
        val since = metric.bufferStartedAtElapsedMs ?: return metric
        val increment = if (metric.firstFrameElapsedMs == null) 0L else
            (now - since).coerceIn(0L, 600_000L)
        val updated = metric.copy(
            rebufferDurationMs = (metric.rebufferDurationMs + increment).coerceAtMost(3_600_000L),
            bufferStartedAtElapsedMs = null
        )
        replace(metric, updated)
        return updated
    }

    fun error(metric: PlaybackMetric, code: String?, message: String?): PlaybackMetric {
        val safeCode = DiagnosticsSanitizer.sanitizeErrorCode(code)
        val safeMessage = DiagnosticsSanitizer.sanitizeMessage(message)
        val updated = finish(metric).copy(errorCode = safeCode, errorMessage = safeMessage)
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
