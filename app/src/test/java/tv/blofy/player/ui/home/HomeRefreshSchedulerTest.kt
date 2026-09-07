package tv.blofy.player.ui.home

import android.app.Application
import android.os.Handler
import android.os.Looper
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.annotation.LooperMode
import java.time.Duration

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28], application = Application::class)
@LooperMode(LooperMode.Mode.PAUSED)
class HomeRefreshSchedulerTest {
    @Test fun pausedHomeStopsBothLoopsAndRepeatedResumeStartsOnlyOneLoop() {
        var clocks = 0
        var heroes = 0
        val scheduler = HomeRefreshScheduler(Handler(Looper.getMainLooper()), 30_000, 8_000,
            { clocks++ }, { heroes++ })
        val main = shadowOf(Looper.getMainLooper())
        repeat(4) { scheduler.start() }
        main.idle()
        assertEquals(1, clocks)
        main.idleFor(Duration.ofSeconds(8))
        assertEquals(1, heroes)
        scheduler.stop()
        main.idleFor(Duration.ofMinutes(5))
        assertEquals(1, clocks)
        assertEquals(1, heroes)
        repeat(4) { scheduler.start() }
        main.idle()
        assertEquals(2, clocks)
        main.idleFor(Duration.ofSeconds(8))
        assertEquals(2, heroes)
        scheduler.stop()
    }

    @Test fun lateCatalogCompletionCannotRestartHeroWhilePaused() {
        var heroes = 0
        val scheduler = HomeRefreshScheduler(Handler(Looper.getMainLooper()), 30_000, 8_000,
            {}, { heroes++ })
        scheduler.start()
        scheduler.stop()
        scheduler.restartHero()
        shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMinutes(1))
        assertEquals(0, heroes)
    }
}
