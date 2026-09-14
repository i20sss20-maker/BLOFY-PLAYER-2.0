package tv.blofy.player.ui.home

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import kotlinx.coroutines.yield
import org.junit.Assert.*
import org.junit.Test

class HomeHistoryObserverTest {
    @Test fun returningHomeRefreshesOnceAndAlsoObservesALateResumeWrite(): Unit = runBlocking {
        val changes = MutableStateFlow(0)
        val rendered = Channel<Int>(Channel.UNLIMITED)
        val observer = HomeHistoryObserver(this, { changes }) { rendered.send(changes.value) }
        try {
            repeat(4) { observer.start() }
            assertEquals(0, withTimeout(5_000) { rendered.receive() })
            yield()
            assertTrue(rendered.tryReceive().isFailure)

            observer.stop()
            changes.value = 1
            yield()
            assertTrue(rendered.tryReceive().isFailure)

            observer.start()
            assertEquals(1, withTimeout(5_000) { rendered.receive() })
            changes.value = 2 // Application-owned resume persistence completes after Home resumes.
            assertEquals(2, withTimeout(5_000) { rendered.receive() })
        } finally { observer.stop() }
    }

    @Test fun newerHistoryCancelsSlowReadsAndPausePreventsLateRendering(): Unit = runBlocking {
        val changes = MutableStateFlow(0)
        val started = CompletableDeferred<Unit>()
        val rendered = Channel<Int>(Channel.UNLIMITED)
        val observer = HomeHistoryObserver(this, { changes }) {
            val value = changes.value
            if (value == 0) {
                started.complete(Unit)
                awaitCancellation()
            }
            rendered.send(value)
        }
        try {
            observer.start()
            withTimeout(5_000) { started.await() }
            changes.value = 1
            assertEquals(1, withTimeout(5_000) { rendered.receive() })
            observer.stop()
            changes.value = 2
            yield()
            assertTrue(rendered.tryReceive().isFailure)
        } finally { observer.stop() }
    }
}
