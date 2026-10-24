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
