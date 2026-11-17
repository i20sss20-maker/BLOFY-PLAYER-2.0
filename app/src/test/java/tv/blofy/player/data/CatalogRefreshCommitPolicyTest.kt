package tv.blofy.player.data

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class CatalogRefreshCommitPolicyTest {
    @Test fun normalPromotionReturnsOnlyAfterWriteCompletes() = runBlocking {
        assertEquals(42, CatalogRefreshCommitPolicy.run(timeoutMillis = 1_000L) { 42 })
    }

    @Test fun stuckFinalizationAt95PercentTimesOutInsteadOfWaitingForever() = runBlocking {
        var finished = false
        val error = runCatching {
            CatalogRefreshCommitPolicy.run(timeoutMillis = 50L) {
                delay(5_000L)
                finished = true
            }
        }.exceptionOrNull()
        assertTrue(error is TimeoutCancellationException)
        assertFalse(finished)
    }

    @Test fun cancelingWorkerDoesNotInterruptAnAlreadyStartedDatabaseCommit() = runBlocking {
        val started = CompletableDeferred<Unit>()
        val release = CompletableDeferred<Unit>()
        var committed = false
        val job = launch(Dispatchers.Default) {
            CatalogRefreshCommitPolicy.run(timeoutMillis = 5_000L) {
                started.complete(Unit)
                release.await()
                committed = true
            }
        }
        started.await()
        job.cancel()
        release.complete(Unit)
        job.join()
        assertTrue(committed)
        assertTrue(job.isCancelled)
    }

    @Test fun onlyManualFinalSaveTimeoutFailsFast() {
        assertTrue(CatalogRefreshCommitPolicy.shouldFailManualCommitTimeout(true, "SAVE"))
        assertFalse(CatalogRefreshCommitPolicy.shouldFailManualCommitTimeout(false, "SAVE"))
        assertFalse(CatalogRefreshCommitPolicy.shouldFailManualCommitTimeout(true, "SERIES"))
        assertFalse(CatalogRefreshCommitPolicy.shouldFailManualCommitTimeout(true, "LIVE"))
    }

    @Test(expected = IllegalArgumentException::class)
    fun rejectsNonPositiveTimeout() = runBlocking {
        CatalogRefreshCommitPolicy.run(timeoutMillis = 0L) { Unit }
    }
}
