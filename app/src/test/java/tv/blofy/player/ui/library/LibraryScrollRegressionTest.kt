package tv.blofy.player.ui.library

import android.os.Looper
import android.view.KeyEvent
import android.view.View
import android.view.ViewGroup
import androidx.recyclerview.widget.GridLayoutManager
import androidx.recyclerview.widget.RecyclerView
import androidx.room.Room
import kotlinx.coroutines.Dispatchers
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
import tv.blofy.player.data.local.BlofyDatabase
import tv.blofy.player.data.local.ProviderEntity
import tv.blofy.player.data.local.StreamEntity
import tv.blofy.player.ui.catalog.PosterStreamAdapter
import tv.blofy.player.ui.details.MovieDetailsActivity
import java.time.Duration
import java.util.concurrent.TimeUnit

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28], application = tv.blofy.player.data.local.InMemoryKeystoreApplication::class,
    qualifiers = "w960dp-h540dp-land-television-mdpi")
@LooperMode(LooperMode.Mode.PAUSED)
class LibraryScrollRegressionTest {
    private lateinit var db: BlofyDatabase
    private var controller: ActivityController<LibraryActivity>? = null
    private val singletonField = BlofyDatabase::class.java.getDeclaredField("instance").apply { isAccessible = true }
    private var previousDatabase: Any? = null

    @Before fun setup() {
        db = Room.inMemoryDatabaseBuilder(RuntimeEnvironment.getApplication(), BlofyDatabase::class.java).build()
        previousDatabase = singletonField.get(null)
        singletonField.set(null, db)
        runBlocking(Dispatchers.IO) {
            db.dao().saveAndActivateProvider(ProviderEntity("saved", "Saved", "https://example.test", "viewer", "secret"))
            db.dao().upsertStreams((1..30).map { index ->
                StreamEntity("saved:movie:$index", "saved", index.toString(), null, "movie",
                    "Film ${index.toString().padStart(2, '0')}", favorite = true)
            })
        }
    }

    @After fun cleanup() {
        controller?.pause()?.stop()?.destroy()
        shadowOf(Looper.getMainLooper()).idle()
        singletonField.set(null, previousDatabase)
        db.close()
    }

    private fun launch(): Pair<LibraryActivity, RecyclerView> {
        val activity = Robolectric.buildActivity(LibraryActivity::class.java).also { controller = it }.setup().visible().get()
        val grid = LibraryActivity::class.java.getDeclaredField("favoritesGrid").apply { isAccessible = true }
            .get(activity) as RecyclerView
        await { grid.adapter?.itemCount == 30 }
        layout(activity)
        return activity to grid
    }

    private fun layout(activity: LibraryActivity) {
        val root = activity.findViewById<ViewGroup>(android.R.id.content).getChildAt(0)
        root.measure(View.MeasureSpec.makeMeasureSpec(960, View.MeasureSpec.EXACTLY),
            View.MeasureSpec.makeMeasureSpec(540, View.MeasureSpec.EXACTLY))
        root.layout(0, 0, 960, 540)
        shadowOf(Looper.getMainLooper()).idle()
    }

    private fun press(activity: LibraryActivity, key: Int) {
        val handled = activity.dispatchKeyEvent(KeyEvent(KeyEvent.ACTION_DOWN, key))
        if (!handled) {
            // Real DPAD events pass through ViewRootImpl after Activity dispatch.
            // Robolectric's direct Activity call needs that unhandled focus step.
            val direction = when (key) {
                KeyEvent.KEYCODE_DPAD_DOWN -> View.FOCUS_DOWN
                KeyEvent.KEYCODE_DPAD_UP -> View.FOCUS_UP
                KeyEvent.KEYCODE_DPAD_LEFT -> View.FOCUS_LEFT
                KeyEvent.KEYCODE_DPAD_RIGHT -> View.FOCUS_RIGHT
                else -> error("Unsupported direction")
            }
            activity.currentFocus?.focusSearch(direction)?.requestFocus(direction)
        }
        activity.dispatchKeyEvent(KeyEvent(KeyEvent.ACTION_UP, key))
        shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(250))
        layout(activity)
    }

    @Test fun allThirtyFavoritesCanBeReachedAndRemainVisibleWithTheRemote() {
        val (activity, grid) = launch()
        val manager = grid.layoutManager as GridLayoutManager
        assertTrue("Favorites use recycled poster cards", grid.adapter is PosterStreamAdapter)
        assertTrue(grid.findViewHolderForAdapterPosition(0)!!.itemView.requestFocus())
        repeat((29 / manager.spanCount)) { row ->
            press(activity, KeyEvent.KEYCODE_DPAD_DOWN)
            assertEquals("Remote navigation down to row ${row + 1}",
                (row + 1) * manager.spanCount, grid.getChildAdapterPosition(grid.focusedChild!!))
        }
        repeat(29 % manager.spanCount) { column ->
            press(activity, KeyEvent.KEYCODE_DPAD_LEFT)
            assertEquals("Remote navigation across the last row", 29 / manager.spanCount * manager.spanCount + column + 1,
                grid.getChildAdapterPosition(grid.focusedChild!!))
        }
        val last = grid.findViewHolderForAdapterPosition(29)?.itemView
        assertNotNull("The last poster must be attached after remote navigation", last)
        assertTrue("The last poster must receive focus", last!!.hasFocus())
        assertTrue("The grid must scroll to keep the poster on screen", grid.computeVerticalScrollOffset() > 0)
        assertTrue(last.top >= grid.paddingTop && last.bottom <= grid.height - grid.paddingBottom)
        repeat(29 % manager.spanCount) { press(activity, KeyEvent.KEYCODE_DPAD_RIGHT) }
        repeat(29 / manager.spanCount) { press(activity, KeyEvent.KEYCODE_DPAD_UP) }
        assertTrue("Remote navigation must return to the first poster", grid.findViewHolderForAdapterPosition(0)!!.itemView.hasFocus())
    }

    @Test fun favoritesHaveImageViewsAndKeepTheExistingDetailsRoute() {
        val (activity, grid) = launch()
        val holder = grid.findViewHolderForAdapterPosition(0) as PosterStreamAdapter.Holder
        assertNotNull(holder.image)
        assertTrue("A poster has a real measured viewport", holder.image.width > 0 && holder.image.height > 0)
        assertEquals("Film 01", holder.title.text.toString())
        holder.itemView.performClick()
        val intent = shadowOf(activity).nextStartedActivity
        assertEquals(MovieDetailsActivity::class.java.name, intent.component?.className)
        assertEquals("saved", intent.getStringExtra(MovieDetailsActivity.EXTRA_PROVIDER_ID))
        assertEquals("saved:movie:1", intent.getStringExtra(MovieDetailsActivity.EXTRA_CONTENT_KEY))
    }

    @Test fun removingAFavoriteRefreshesTheGridAndReturningDoesNotDuplicateItems() {
        val (activity, grid) = launch()
        runBlocking(Dispatchers.IO) { db.dao().setFavorite("saved:movie:1", false) }
        await { grid.adapter?.itemCount == 29 }
        val adapter = grid.adapter as PosterStreamAdapter
        assertEquals("saved:movie:2", adapter.itemAt(0)?.key)
        checkNotNull(controller).pause().stop().start().resume().visible()
        await { grid.adapter?.itemCount == 29 }
        layout(activity)
        assertEquals(29, adapter.itemCount)
        assertFalse((0 until adapter.itemCount).any { adapter.itemAt(it)?.key == "saved:movie:1" })
    }

    private fun await(condition: () -> Boolean) {
        val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(10)
        do {
            shadowOf(Looper.getMainLooper()).idle()
            if (condition()) return
            Thread.sleep(10)
        } while (System.nanoTime() < deadline)
        fail("Favorites did not finish updating")
    }
}
