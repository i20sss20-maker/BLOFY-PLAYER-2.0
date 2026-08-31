package tv.blofy.player.data

import kotlinx.coroutines.withTimeout

enum class PlaylistSyncStage {
    M3U,
    LIVE,
    MOVIES,
    SERIES
}

data class PlaylistSyncProgress(
    val stage: PlaylistSyncStage,
    val step: Int,
    val totalSteps: Int
)

/** One upper bound for a complete provider refresh, in addition to per-request limits. */
object PlaylistSyncPolicy {
    const val DEFAULT_TIMEOUT_MILLIS = 75_000L

    suspend fun <T> run(
        timeoutMillis: Long = DEFAULT_TIMEOUT_MILLIS,
        block: suspend () -> T
    ): T {
        require(timeoutMillis > 0) { "timeoutMillis must be positive" }
        return withTimeout(timeoutMillis) { block() }
    }
}
