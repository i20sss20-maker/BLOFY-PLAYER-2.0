package tv.blofy.player.data

import kotlinx.coroutines.CancellationException
import java.util.concurrent.atomic.AtomicInteger

/** Fast but bounded catalogue checks. WorkManager can delay an execution on some TVs. */
internal object CatalogAutoRefreshPolicy {
    const val INTERVAL_MINUTES = 30L
    const val MINIMUM_GAP_MS = INTERVAL_MINUTES * 60_000L

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
        activePlayers.updateAndGet { previous -> (previous - 1).coerceAtLeast(0) }
    }

    val isPlaying: Boolean get() = activePlayers.get() > 0
}

/** Cooperative deferral must propagate past per-section retry/catch handlers. */
internal class PlaybackInProgressException : CancellationException("Playback has priority over catalogue refresh")
