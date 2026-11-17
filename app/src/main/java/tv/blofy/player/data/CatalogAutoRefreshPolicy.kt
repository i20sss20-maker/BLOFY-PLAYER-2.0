package tv.blofy.player.data

import kotlinx.coroutines.CancellationException
import android.content.Context
import tv.blofy.player.BuildConfig
import java.util.concurrent.atomic.AtomicInteger

/** Daily, bounded catalogue checks. Android may defer execution on sleeping TVs. */
internal object CatalogAutoRefreshPolicy {
    const val INTERVAL_MINUTES = 24L * 60L
    const val MINIMUM_GAP_MS = INTERVAL_MINUTES * 60_000L
    // Ordinary WorkManager jobs have about ten minutes before forced stop.
    // Leave time for staged SQLite rollback even when an upstream source stalls.
    const val MAX_SINGLE_SYNC_MS = 7L * 60_000L

    private const val PREFS = "blofy_stream_catalog_auto_sync_v1"
    private const val ENABLED = "enabled"

    /** STREAM defaults to daily sync, unlike the previous code-only build where it was disabled. */
    fun isEnabled(context: Context): Boolean =
        !BuildConfig.CODE_ONLY_LOGIN || context.applicationContext
            .getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean(ENABLED, true)

    /** This is a user setting; the scheduler must be updated separately. */
    fun setEnabled(context: Context, enabled: Boolean): Boolean =
        context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit().putBoolean(ENABLED, enabled).commit()

    /** A successful sync, not a queued or failed attempt, resets the refresh clock. */
    fun isDue(lastCompletedAtMs: Long, nowMs: Long): Boolean =
        lastCompletedAtMs <= 0L ||
            (nowMs >= lastCompletedAtMs && nowMs - lastCompletedAtMs >= MINIMUM_GAP_MS)
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
