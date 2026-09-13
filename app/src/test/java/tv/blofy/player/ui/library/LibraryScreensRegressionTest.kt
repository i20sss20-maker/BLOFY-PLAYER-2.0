package tv.blofy.player.ui.library

import android.app.Application
import android.os.Looper
import android.view.KeyEvent
import android.view.View
import android.widget.Button
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ScrollView
import androidx.appcompat.app.AppCompatActivity
import androidx.room.Room
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.android.controller.ActivityController
import org.robolectric.annotation.Config
import org.robolectric.annotation.LooperMode
import tv.blofy.player.data.RecentChannelStore
import tv.blofy.player.data.local.BlofyDatabase
import tv.blofy.player.data.local.ProviderEntity
import tv.blofy.player.data.local.StreamEntity
import tv.blofy.player.data.profile.ProfileLibraryStore
import tv.blofy.player.ui.details.MovieDetailsActivity
import tv.blofy.player.ui.details.SeriesDetailsActivity
import java.time.Duration
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference

/** Actual screen/Room regressions; every provider and catalog row is local test data. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28], application = Application::class, qualifiers = "w1280dp-h720dp-land")
@LooperMode(LooperMode.Mode.PAUSED)
class LibraryScreensRegressionTest {
    private val app get() = RuntimeEnvironment.getApplication()
    private lateinit var db: BlofyDatabase
    private val executor = Executors.newSingleThreadExecutor()
    private val queryGate = AtomicReference<QueryGate?>()
    private val singleton = BlofyDatabase::class.java.getDeclaredField("instance").apply { isAccessible = true }
    private var previousDatabase: Any? = null
    private var controller: ActivityController<out AppCompatActivity>? = null
    private val movie = StreamEntity("a:movie:1", "a", "1", null, "movie", "Film A")
    private val series = StreamEntity("b:series:1", "b", "1", null, "series", "Series B")

    @Before fun setup() {
        app.getSharedPreferences("blofy_profile_library_v1", 0).edit().clear().commit()
        app.getSharedPreferences("blofy_recent_channels", 0).edit().clear().commit()
        db = Room.inMemoryDatabaseBuilder(app, BlofyDatabase::class.java)
            .setQueryExecutor { task ->
                executor.execute {
                    queryGate.get()?.let { gate ->
                        gate.entered.countDown()
                        check(gate.released.await(10, TimeUnit.SECONDS)) { "Test query gate timed out" }
                    }
                    task.run()
                }
            }.build()
        previousDatabase = singleton.get(null)
        singleton.set(null, db)
        runBlocking(Dispatchers.IO) {
            db.dao().upsertProviderStored(ProviderEntity("a", "A", "https://a.example.test", "a", "a", enabled = false))
            db.dao().upsertProviderStored(ProviderEntity("b", "B", "https://b.example.test", "b", "b"))
            db.dao().upsertStreams(listOf(movie, series))
        }
    }

    @After fun cleanup() {
        queryGate.getAndSet(null)?.released?.countDown()
        controller?.pause()?.stop()?.destroy()
        shadowOf(Looper.getMainLooper()).idle()
        singleton.set(null, previousDatabase)
        db.close()
        executor.shutdownNow()
    }

    @Test fun firstLaunchAndRepeatedResumeRenderEachTitleExactlyOnce() {
        watch(movie, series)
        val activity = launchWatchlist()
        awaitWatchlist(activity)
        assertEquals(listOf("Series B", "Film A"), rows(activity).map { it.text.toString() })
        repeat(3) {
            checkNotNull(controller).pause().resume()
            awaitWatchlist(activity)
            assertEquals(2, rows(activity).size)
        }
    }

    @Test fun movieAndSeriesOpenWithTheirOwnProviderEvenWhenAnotherProviderIsActive() {
        watch(movie, series)
        val activity = launchWatchlist()
        awaitWatchlist(activity)
        for ((item, target) in listOf(movie to MovieDetailsActivity::class.java, series to SeriesDetailsActivity::class.java)) {
            assertTrue(rows(activity).single { it.text.toString() == item.name }.performClick())
            val intent = shadowOf(activity).nextStartedActivity
            assertEquals(target.name, intent.component?.className)
            assertEquals(item.providerId, intent.getStringExtra("provider_id"))
            assertEquals(item.key, intent.getStringExtra("content_key"))
        }
    }

    @Test fun supersededSlowLoadCannotBringBackARemovedTitle() {
        watch(movie, series)
        val gate = QueryGate().also(queryGate::set)
        val activity = launchWatchlist()
        assertTrue("Expected the old load to reach Room", gate.entered.await(5, TimeUnit.SECONDS))
        val oldJob = watchlistJob(activity)
        assertNotNull(oldJob)
        assertTrue(ProfileLibraryStore.setWatchlisted(app, movie.key, false))
        checkNotNull(controller).pause().resume()
        assertTrue("Replacing the load must cancel its database work", oldJob!!.isCancelled)
        queryGate.set(null)
        gate.released.countDown()
        awaitWatchlist(activity)
        assertEquals(listOf("Series B"), rows(activity).map { it.text.toString() })
    }

    @Test fun longPressingTheLastTitleLeavesOneEmptyStateAfterReturning() {
        watch(movie)
        val activity = launchWatchlist()
        awaitWatchlist(activity)
        assertTrue(rows(activity).single().performLongClick())
        assertFalse(ProfileLibraryStore.isWatchlisted(app, movie.key))
        repeat(2) {
            checkNotNull(controller).pause().resume()
            awaitWatchlist(activity)
        }
        assertTrue(rows(activity).isEmpty())
        assertEquals("Two headings and one empty state", 3, watchlist(activity).childCount)
    }

    @Test fun allThirtyRecentChannelsRemainReachableWithTheRemote() {
        runBlocking(Dispatchers.IO) {
            db.dao().upsertStreams((1..30).map { index ->
                StreamEntity("b:live:$index", "b", "$index", null, "live", "Channel $index").also {
                    RecentChannelStore.record(app, "b", it.key)
                }
            })
        }
        val recent = Robolectric.buildActivity(RecentChannelsActivity::class.java).also { controller = it }.setup().visible().get()
        val root = recent.findViewById<FrameLayout>(android.R.id.content).getChildAt(0) as LinearLayout
        assertTrue("Recent channels need a scrollable viewport", root.getChildAt(2) is ScrollView)
        val scroll = root.getChildAt(2) as ScrollView
        val list = scroll.getChildAt(0) as LinearLayout
        await("recent channels") { list.childCount == 30 }
        recent.window.decorView.apply {
            measure(View.MeasureSpec.makeMeasureSpec(1280, View.MeasureSpec.EXACTLY), View.MeasureSpec.makeMeasureSpec(720, View.MeasureSpec.EXACTLY))
            layout(0, 0, 1280, 720)
        }
        scroll.isSmoothScrollingEnabled = false
        assertTrue(list.getChildAt(0).requestFocus())
        repeat(29) {
            recent.dispatchKeyEvent(KeyEvent(KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_DPAD_DOWN))
            recent.dispatchKeyEvent(KeyEvent(KeyEvent.ACTION_UP, KeyEvent.KEYCODE_DPAD_DOWN))
            shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(100))
        }
        assertTrue("Remote focus must reach channel 30", list.getChildAt(29).hasFocus())
        assertTrue("The focused row must scroll into view", scroll.scrollY > 0)
        assertTrue(list.getChildAt(29).bottom <= scroll.scrollY + scroll.height)
    }

    private fun watch(vararg items: StreamEntity) {
        items.forEach { assertTrue(ProfileLibraryStore.setWatchlisted(app, it.key, true)) }
    }

    private fun launchWatchlist() = Robolectric.buildActivity(ProfileWatchlistActivity::class.java)
        .also { controller = it }.setup().visible().get()

    private fun watchlist(activity: ProfileWatchlistActivity): LinearLayout {
        val content = activity.findViewById<FrameLayout>(android.R.id.content)
        return (content.getChildAt(0) as ScrollView).getChildAt(0) as LinearLayout
    }

    private fun rows(activity: ProfileWatchlistActivity): List<Button> = watchlist(activity).let { list ->
        (2 until list.childCount).mapNotNull { list.getChildAt(it) as? Button }
    }

    private fun watchlistJob(activity: ProfileWatchlistActivity) = ProfileWatchlistActivity::class.java
        .getDeclaredField("loadJob").apply { isAccessible = true }.get(activity) as Job?

    private fun awaitWatchlist(activity: ProfileWatchlistActivity) = await("watchlist") { watchlistJob(activity)?.isActive != true }

    private fun await(label: String, condition: () -> Boolean) {
        val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(10)
        do {
            shadowOf(Looper.getMainLooper()).idle()
            if (condition()) return
            Thread.sleep(5)
        } while (System.nanoTime() < deadline)
        fail("Timed out waiting for $label")
    }

    private class QueryGate {
        val entered = CountDownLatch(1)
        val released = CountDownLatch(1)
    }
}
