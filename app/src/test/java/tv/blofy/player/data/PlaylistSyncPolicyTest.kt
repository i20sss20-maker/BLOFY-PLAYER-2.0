package tv.blofy.player.data

import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class PlaylistSyncPolicyTest {
    @Test
    fun returnsCompletedResult() = runBlocking {
        val result = PlaylistSyncPolicy.run(timeoutMillis = 1_000) { "done" }

        assertEquals("done", result)
    }

    @Test
    fun stopsWorkAtOverallTimeout() = runBlocking {
        var timedOut = false

        try {
            PlaylistSyncPolicy.run(timeoutMillis = 25) { delay(5_000) }
        } catch (_: TimeoutCancellationException) {
            timedOut = true
        }

        assertTrue(timedOut)
    }

    @Test
    fun propagatesCallerCancellation() = runBlocking {
        val job = launch {
            PlaylistSyncPolicy.run(timeoutMillis = 10_000) { awaitCancellation() }
        }

        job.cancelAndJoin()

        assertTrue(job.isCancelled)
    }

    @Test(expected = IllegalArgumentException::class)
    fun rejectsNonPositiveTimeout() = runBlocking {
        PlaylistSyncPolicy.run(timeoutMillis = 0) { Unit }
    }
}
