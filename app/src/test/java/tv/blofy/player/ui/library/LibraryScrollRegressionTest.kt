package tv.blofy.player.ui.library

import android.app.Application
import android.os.Looper
import android.view.KeyEvent
import android.view.View
import android.view.ViewGroup
import android.widget.LinearLayout
import android.widget.ScrollView
import androidx.room.Room
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
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
import java.util.concurrent.TimeUnit

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28], application = Application::class, qualifiers = "w960dp-h540dp-land-mdpi")
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

    @Test fun allThirtyFavoritesCanBeReachedAndRemainVisibleWithTheRemote() {
        controller = Robolectric.buildActivity(LibraryActivity::class.java).setup().visible()
        val activity = checkNotNull(controller).get()
        val list = LibraryActivity::class.java.getDeclaredField("list").apply { isAccessible = true }
            .get(activity) as LinearLayout
        val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(10)
        while (list.childCount != 30) {
            shadowOf(Looper.getMainLooper()).idle()
            if (System.nanoTime() >= deadline) fail("Library favorites did not finish loading")
            Thread.sleep(10)
        }
        assertTrue("Library rows need a scrollable viewport", list.parent is ScrollView)
        val scroll = list.parent as ScrollView
        // Focus scrolling is checked without depending on animation timing.
        scroll.isSmoothScrollingEnabled = false
        val root = activity.findViewById<ViewGroup>(android.R.id.content).getChildAt(0)
        root.measure(View.MeasureSpec.makeMeasureSpec(960, View.MeasureSpec.EXACTLY),
            View.MeasureSpec.makeMeasureSpec(540, View.MeasureSpec.EXACTLY))
        root.layout(0, 0, 960, 540)
        assertTrue("The rows must exceed the viewport", list.height > scroll.height)
        assertTrue(list.getChildAt(0).requestFocus())
        for (index in 1 until list.childCount) {
            activity.dispatchKeyEvent(KeyEvent(KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_DPAD_DOWN))
            activity.dispatchKeyEvent(KeyEvent(KeyEvent.ACTION_UP, KeyEvent.KEYCODE_DPAD_DOWN))
            assertSame("Remote navigation to row $index", list.getChildAt(index), list.findFocus())
        }
        val last = list.getChildAt(29)
        assertTrue("The viewport must scroll down", scroll.scrollY > 0)
        assertTrue("The final row must be inside the visible viewport", last.top >= scroll.scrollY)
        assertTrue("The final row must not remain below the screen", last.bottom <= scroll.scrollY + scroll.height)

        for (index in 28 downTo 0) {
            activity.dispatchKeyEvent(KeyEvent(KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_DPAD_UP))
            activity.dispatchKeyEvent(KeyEvent(KeyEvent.ACTION_UP, KeyEvent.KEYCODE_DPAD_UP))
            assertSame("Remote navigation back to row $index", list.getChildAt(index), list.findFocus())
        }
        val first = list.getChildAt(0)
        assertSame("Returning up restores focus to the first row", first, list.findFocus())
        // The row has an existing top margin. ScrollView may align to the row's top rather
        // than offset zero; the requirement is that the entire focused row stays visible.
        assertTrue("The first row must not be clipped above the viewport", first.top >= scroll.scrollY)
        assertTrue("The first row must fit inside the viewport", first.bottom <= scroll.scrollY + scroll.height)
    }
}
