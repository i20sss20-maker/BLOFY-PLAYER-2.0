package tv.blofy.player.data.preparation

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import org.junit.Assert.*
import org.junit.Test
import java.util.concurrent.atomic.AtomicInteger

class BoundedDownloadsTest {
    @Test fun slowImageDoesNotBlockLaterImagesAndConcurrencyRemainsBounded() = runBlocking {
        val slow = CompletableDeferred<Unit>()
        val last = CompletableDeferred<Unit>()
        val active = AtomicInteger()
        val peak = AtomicInteger()
        val job = launch {
            forEachDownload((0..15).toList(), 3) { index ->
                val current = active.incrementAndGet()
                peak.updateAndGet { maxOf(it, current) }
                try {
                    if (index == 0) slow.await()
                    if (index == 15) last.complete(Unit)
                } finally { active.decrementAndGet() }
            }
        }
        try {
            withTimeout(2_000) { last.await() }
            assertFalse(job.isCompleted)
            assertTrue(peak.get() <= 3)
        } finally { slow.complete(Unit); job.join() }
        assertEquals(0, active.get())
    }
}
