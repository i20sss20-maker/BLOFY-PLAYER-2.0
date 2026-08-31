package tv.blofy.player.data

import kotlinx.coroutines.withTimeout

enum class PlaylistSyncStage { M3U, LIVE, MOVIES, SERIES }

data class PlaylistSyncProgress(
    val stage: PlaylistSyncStage,
    val step: Int,
    val totalSteps: Int,
    val percentOverride: Int? = null
) {
    /** Overall progress for the first full catalog download. */
    val percent: Int
        get() = percentOverride?.coerceIn(0, 100) ?: when (stage) {
            PlaylistSyncStage.M3U -> 50
            PlaylistSyncStage.LIVE -> 25
            PlaylistSyncStage.MOVIES -> 60
            PlaylistSyncStage.SERIES -> 90
        }
}

/**
 * Catalog synchronization policy only. Playback networking is intentionally unrelated.
 * Huge Xtream catalogs can legitimately need many minutes to download, parse and commit.
 */
object PlaylistSyncPolicy {
    const val DEFAULT_TIMEOUT_MILLIS = 30 * 60_000L

    suspend fun <T> run(timeoutMillis: Long = DEFAULT_TIMEOUT_MILLIS, block: suspend () -> T): T {
        require(timeoutMillis > 0) { "timeoutMillis must be positive" }
        return withTimeout(timeoutMillis) { block() }
    }
}
