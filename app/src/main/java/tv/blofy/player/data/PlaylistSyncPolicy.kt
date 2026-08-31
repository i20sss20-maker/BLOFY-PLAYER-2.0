package tv.blofy.player.data

import kotlinx.coroutines.withTimeout

enum class PlaylistSyncStage { M3U, LIVE, MOVIES, SERIES }

data class PlaylistSyncProgress(
    val stage: PlaylistSyncStage,
    val step: Int,
    val totalSteps: Int
) {
    /** Stable overall progress for the first full catalog download. */
    val percent: Int
        get() = when (stage) {
            PlaylistSyncStage.M3U -> 50
            PlaylistSyncStage.LIVE -> 25
            PlaylistSyncStage.MOVIES -> 60
            PlaylistSyncStage.SERIES -> 90
        }
}

/**
 * Catalog synchronization policy only. Playback networking is intentionally unrelated.
 * Large Xtream catalogs can legitimately need several minutes to download, parse and commit.
 * A 75-second whole-catalog deadline caused otherwise healthy large providers to fail around VOD.
 */
object PlaylistSyncPolicy {
    const val DEFAULT_TIMEOUT_MILLIS = 15 * 60_000L

    suspend fun <T> run(timeoutMillis: Long = DEFAULT_TIMEOUT_MILLIS, block: suspend () -> T): T {
        require(timeoutMillis > 0) { "timeoutMillis must be positive" }
        return withTimeout(timeoutMillis) { block() }
    }
}
