package tv.blofy.player.data.local

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.cancel
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Test
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

class BlockingStartupTaskTest {
    @Test fun timeoutDoesNotWaitForBlockingDatabaseOpenOrLaunchDuplicateOpens() = runBlocking {
        val owner = CoroutineScope(SupervisorJob() + Dispatchers.IO)
        val entered = CountDownLatch(1)
        val release = CountDownLatch(1)
        val calls = AtomicInteger()
        val initializer = BlockingStartupTask(owner) {
            calls.incrementAndGet()
            entered.countDown()
            check(release.await(5, TimeUnit.SECONDS))
        }
        try {
            initializer.start()
            assertTrue(entered.await(2, TimeUnit.SECONDS))
            val start = System.nanoTime()
            assertFalse(initializer.awaitReady(75L))
            assertFalse(initializer.awaitReady(75L))
            val waitedMs = TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - start)
            assertTrue("UI waiter took $waitedMs ms while work was blocked", waitedMs < 1_500L)
            assertEquals(1, calls.get())
            assertEquals(1L, release.count)
            release.countDown()
            assertTrue(initializer.awaitReady(2_000L))
            assertEquals(1, calls.get())
        } finally { release.countDown(); owner.cancel() }
    }

    @Test fun failedOpenCanRetryWithoutResettingUserData() = runBlocking {
        val owner = CoroutineScope(SupervisorJob() + Dispatchers.IO)
        val calls = AtomicInteger()
        val initializer = BlockingStartupTask(owner) { if (calls.incrementAndGet() == 1) error("temporary unavailable") }
        try {
            assertFalse(initializer.awaitReady(2_000L))
            assertTrue(initializer.awaitReady(2_000L))
            assertEquals(2, calls.get())
        } finally { owner.cancel() }
    }

    @Test fun cancellingOneScreenDoesNotCancelSharedOpen() = runBlocking {
        val owner = CoroutineScope(SupervisorJob() + Dispatchers.IO)
        val release = CountDownLatch(1)
        val initializer = BlockingStartupTask(owner) { check(release.await(5, TimeUnit.SECONDS)) }
        try {
            val work = initializer.start()
            val screen = async { initializer.awaitReady(2_000L) }
            screen.cancel()
            screen.join()
            assertFalse(work.isCancelled)
            release.countDown()
            assertTrue(initializer.awaitReady(2_000L))
        } finally { release.countDown(); owner.cancel() }
    }
}
