package tv.blofy.player.data

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout

/**
 * A streamed refresh can legitimately reach 95% before its final Room transaction completes.
 * A canceled Worker must not interrupt a committed-but-unmarked swap, yet a stalled transaction
 * must not hold the existing usable catalog hostage indefinitely.
 *
 * Call this only after the source/checkpoint/integrity checks have passed. Room transaction
 * cancellation is responsible for rolling back incomplete database writes.
 */
internal object CatalogRefreshCommitPolicy {
    const val MAX_COMMIT_MILLIS = 3L * 60_000L

    /** A stalled manual final save should return to the user, not repeat long silent retries. */
    fun shouldFailManualCommitTimeout(manual: Boolean, lastStage: String): Boolean =
        manual && lastStage == "SAVE"

    suspend fun <T> run(
        timeoutMillis: Long = MAX_COMMIT_MILLIS,
        commit: suspend () -> T
    ): T {
        require(timeoutMillis > 0L) { "Commit timeout must be positive" }
        currentCoroutineContext().ensureActive()
        return withContext(NonCancellable + Dispatchers.IO) {
            withTimeout(timeoutMillis) { commit() }
        }
    }
}
