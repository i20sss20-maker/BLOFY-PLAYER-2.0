package tv.blofy.player.ui.home

import android.os.Looper
import android.view.View
import androidx.room.Room
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.annotation.LooperMode
import tv.blofy.player.data.local.BlofyDatabase
import tv.blofy.player.data.local.InMemoryKeystoreApplication
import tv.blofy.player.ui.login.LoginActivity
import tv.blofy.player.ui.login.StartupEntryState
import java.time.Duration
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28], application = InMemoryKeystoreApplication::class)
@LooperMode(LooperMode.Mode.PAUSED)
class HomeStartupRecoveryTest {
    @Test fun blockedCatalogReadShowsLoadingAndRecoversWithoutWaitingForTheQuery() {
        val app = RuntimeEnvironment.getApplication()
        val queryEntered = CountDownLatch(1)
        val release = CountDownLatch(1)
        val executor = Executors.newSingleThreadExecutor()
        val db = Room.inMemoryDatabaseBuilder(app, BlofyDatabase::class.java)
            .setQueryExecutor { task -> executor.execute {
                queryEntered.countDown()
                check(release.await(10, TimeUnit.SECONDS))
                task.run()
            } }.build()
        val singleton = BlofyDatabase::class.java.getDeclaredField("instance").apply { isAccessible = true }
        val previous = singleton.get(null)
        singleton.set(null, db)
        StartupEntryState.rememberReady(app, "saved", null)
        val controller = Robolectric.buildActivity(HomeActivity::class.java)
        controller.get().savedEntryDeadlineMillis = 100
        try {
            controller.setup().visible()
            assertNotNull(controller.get().window.decorView.findViewWithTag<View>("blofy_home_opening"))
            assertTrue(queryEntered.await(2, TimeUnit.SECONDS))
            shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(120))
            val next = shadowOf(controller.get()).nextStartedActivity
            assertEquals(LoginActivity::class.java.name, next?.component?.className)
            assertTrue(controller.get().isFinishing)
            assertFalse(StartupEntryState.shouldOpenHome(app))
            assertEquals("Recovery must not wait for the blocked query", 1L, release.count)
        } finally {
            release.countDown()
            executor.shutdown()
            executor.awaitTermination(5, TimeUnit.SECONDS)
            controller.pause().stop().destroy()
            shadowOf(Looper.getMainLooper()).idle()
            singleton.set(null, previous)
            db.close()
        }
    }
}
