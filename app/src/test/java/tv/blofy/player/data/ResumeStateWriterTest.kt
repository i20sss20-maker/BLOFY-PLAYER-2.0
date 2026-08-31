package tv.blofy.player.data

import java.util.Collections
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ResumeStateWriterTest {
    @Test
    fun queuedSnapshotIsWrittenAfterTheCallerReturns() = runBlocking {
        val ownerScope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
        val written = CompletableDeferred<ResumeWriteRequest>()
        val writer = ResumeStateWriter(ownerScope) { written.complete(it) }

        assertTrue(
            writer.enqueue(
                ResumeWriteRequest("movie:7", "provider-1", "movie", 42_000L, 90_000L)
            )
        )

        assertEquals(
            ResumeWriteRequest("movie:7", "provider-1", "movie", 42_000L, 90_000L),
            withTimeout(2_000L) { written.await() }
        )
        ownerScope.cancel()
    }

    @Test
    fun liveAndIncompleteRequestsAreNeverPersisted() = runBlocking {
        val ownerScope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
        val writes = Collections.synchronizedList(mutableListOf<ResumeWriteRequest>())
        val writer = ResumeStateWriter(ownerScope) { writes += it }

        assertFalse(writer.enqueue(ResumeWriteRequest("live:1", "provider-1", "live", 5_000L, 0L)))
        assertFalse(writer.enqueue(ResumeWriteRequest("", "provider-1", "movie", 5_000L, 10_000L)))
        assertFalse(writer.enqueue(ResumeWriteRequest("movie:1", "", "movie", 5_000L, 10_000L)))
        assertTrue(writes.isEmpty())
        ownerScope.cancel()
    }

    @Test
    fun oneFailedWriteDoesNotStopTheQueue() = runBlocking {
        val ownerScope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
        val secondWrite = CompletableDeferred<ResumeWriteRequest>()
        var attempts = 0
        val writer = ResumeStateWriter(ownerScope) { request ->
            attempts += 1
            if (attempts == 1) error("temporary database failure")
            secondWrite.complete(request)
        }

        writer.enqueue(ResumeWriteRequest("movie:1", "provider-1", "movie", 1L, 10L))
        writer.enqueue(ResumeWriteRequest("movie:2", "provider-1", "movie", -1L, -1L))

        assertEquals(
            ResumeWriteRequest("movie:2", "provider-1", "movie", 0L, 0L),
            withTimeout(2_000L) { secondWrite.await() }
        )
        ownerScope.cancel()
    }
}
