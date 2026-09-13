package tv.blofy.player.core.diagnostics

import android.app.Application
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import org.junit.After
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28], application = Application::class)
class PlaybackDiagnosticsRetentionTest {
    @After fun cleanup() = PlaybackDiagnostics.clear()

    @Test fun longViewingSessionRetainsOnlyTheLatestHundredStarts() {
        PlaybackDiagnostics.clear()
        val metrics = (0 until 1200).map {
            PlaybackDiagnostics.begin("provider-$it", "live", "https://example.test/live/$it")
        }
        assertEquals(metrics.takeLast(100), PlaybackDiagnostics.snapshot())
        PlaybackDiagnostics.error(metrics.first(), "late", "late callback")
        assertEquals(metrics.takeLast(100), PlaybackDiagnostics.snapshot())
        PlaybackDiagnostics.clear()
        PlaybackDiagnostics.buffering(metrics.last())
        assertTrue(PlaybackDiagnostics.snapshot().isEmpty())
    }

    @Test fun concurrentClearsAndPlaybackEventsDoNotThrowOrExceedTheBound() {
        val pool = Executors.newFixedThreadPool(4)
        try {
            val jobs = (0 until 4).map { worker -> pool.submit {
                repeat(600) { index ->
                    val metric = PlaybackDiagnostics.begin("$worker-$index", "movie", "https://example.test/a")
                    if (index % 3 == 0) PlaybackDiagnostics.clear()
                    PlaybackDiagnostics.firstFrame(metric)
                    PlaybackDiagnostics.buffering(metric)
                    assertTrue(PlaybackDiagnostics.snapshot().size <= 100)
                }
            } }
            jobs.forEach { it.get(20, TimeUnit.SECONDS) }
        } finally { pool.shutdownNow() }
    }

    @Test fun stalledUploadDropsOldPendingTelemetryWithoutBlockingTheCaller() {
        val queue = PlaybackDiagnosticsUploader.createUploadExecutor()
        val started = CountDownLatch(1)
        val release = CountDownLatch(1)
        val latest = CountDownLatch(1)
        val caller = Thread.currentThread()
        try {
            queue.execute { started.countDown(); release.await() }
            assertTrue(started.await(3, TimeUnit.SECONDS))
            repeat(1000) { queue.execute { assertNotSame(caller, Thread.currentThread()) } }
            queue.execute { latest.countDown() }
            assertTrue(queue.queue.size <= 16)
            release.countDown()
            assertTrue(latest.await(3, TimeUnit.SECONDS))
        } finally { release.countDown(); queue.shutdownNow() }
    }
}
