package tv.blofy.player.data

import android.content.Context
import kotlinx.coroutines.CancellationException
import java.util.concurrent.atomic.AtomicInteger

/** Fast but bounded catalogue checks. WorkManager can delay an execution on some TVs. */
internal object CatalogAutoRefreshPolicy {
    // Keep legacy PLAYER's previous schedule; STREAM syncs once a day on
    // unmetered networks to avoid downloading huge Xtream libraries every 30m.
    const val INTERVAL_MINUTES = 30L
    const val MINIMUM_GAP_MS = INTERVAL_MINUTES * 60_000L
    const val STREAM_INTERVAL_MINUTES = 24L * 60L
    const val STREAM_MINIMUM_GAP_MS = STREAM_INTERVAL_MINUTES * 60_000L
    private const val STREAM_PREFS = "blofy_stream_catalog_auto_v1"
    private const val KEY_ENABLED = "enabled"

    /** Explicit user override; for STREAM the default is ON. PLAYER unchanged. */
    fun streamEnabled(context: Context): Boolean =
        context.applicationContext.getSharedPreferences(STREAM_PREFS, Context.MODE_PRIVATE)
            .getBoolean(KEY_ENABLED, true)

    fun setStreamEnabled(context: Context, enabled: Boolean) {
        check(context.applicationContext.getSharedPreferences(STREAM_PREFS, Context.MODE_PRIVATE)
            .edit().putBoolean(KEY_ENABLED, enabled).commit()) {
            "Unable to save automatic catalog sync preference"
        }
    }
    // Ordinary WorkManager jobs have about ten minutes before forced stop.
    // Leave time for staged SQLite rollback even when an upstream source stalls.
    const val MAX_SINGLE_SYNC_MS = 7L * 60_000L

    /** A successful sync, not a queued or failed attempt, resets the refresh clock. */
    fun isDue(
        lastCompletedAtMs: Long,
        nowMs: Long,
        minimumGapMs: Long = MINIMUM_GAP_MS
    ): Boolean {
        require(minimumGapMs > 0L)
        // Reject negative/future timestamps instead of refreshing forever
        // when a TV has an incorrect RTC (a frequent Android 9 issue).
        if (lastCompletedAtMs > nowMs) return false
        return lastCompletedAtMs <= 0L || nowMs - lastCompletedAtMs >= minimumGapMs
    }
}

/** Avoid downloading/rewriting large Xtream libraries while live TV or VOD is playing. */
internal object CatalogPlaybackGate {
    private val activePlayers = AtomicInteger(0)

    fun playerStarted() { activePlayers.incrementAndGet() }

    fun playerStopped() {
        // Compare-and-set is available on Android API 23, unlike some Java 8 atomics.
        var current = activePlayers.get()
        while (current > 0 && !activePlayers.compareAndSet(current, current - 1)) {
            current = activePlayers.get()
        }
    }

    val isPlaying: Boolean get() = activePlayers.get() > 0
}

/** Cooperative deferral must propagate past per-section retry/catch handlers. */
internal class PlaybackInProgressException : CancellationException("Playback has priority over catalogue refresh")
