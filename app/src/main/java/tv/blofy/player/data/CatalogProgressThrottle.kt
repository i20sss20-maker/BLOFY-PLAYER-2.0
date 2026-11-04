package tv.blofy.player.data

import android.os.SystemClock

/**
 * The Xtream parser emits frequent updates for 20k–200k item libraries.
 * Limit view traversal and main-thread switching to twice per second,
 * while preserving section transitions and retry notifications immediately.
 */
internal class CatalogProgressThrottle(
    private val intervalMs: Long = 500L,
    private val clockMs: () -> Long = SystemClock::elapsedRealtime
) {
    private var lastStage: PlaylistSyncStage? = null
    private var lastRetry: Int = 0
    private var lastValidatedSections: Int = -1
    private var lastRenderedMs: Long? = null

    fun shouldRender(update: PlaylistSyncProgress): Boolean {
        val now = clockMs()
        val important = update.stage != lastStage ||
            update.completedSectionCount != lastValidatedSections ||
            (update.retryAttempt > 0 && update.retryAttempt != lastRetry)
        val elapsed = lastRenderedMs?.let { now - it } ?: Long.MAX_VALUE
        if (!important && elapsed < intervalMs) return false
        lastStage = update.stage
        lastRetry = update.retryAttempt
        lastValidatedSections = update.completedSectionCount
        lastRenderedMs = now
        return true
    }
}
