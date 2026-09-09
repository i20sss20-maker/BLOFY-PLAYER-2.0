package tv.blofy.player.ui.common

import android.app.Activity
import android.app.Application
import android.os.Looper
import android.view.KeyEvent
import android.view.View
import android.view.ViewGroup
import android.widget.LinearLayout
import android.widget.TextView
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.android.controller.ActivityController
import org.robolectric.annotation.Config
import org.robolectric.annotation.LooperMode
import java.time.Duration

/** Real RecyclerViews, with more categories than fit on screen; not just index arithmetic. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28], application = Application::class)
@LooperMode(LooperMode.Mode.PAUSED)
class TwoPaneOffscreenFocusTest {
    private lateinit var controller: ActivityController<Activity>
    private lateinit var root: LinearLayout
    private lateinit var categories: RecyclerView
    private lateinit var content: RecyclerView

    @Before fun setup() {
        controller = Robolectric.buildActivity(Activity::class.java).setup().visible()
        val activity = controller.get()
        root = LinearLayout(activity).apply { orientation = LinearLayout.HORIZONTAL }
        fun list() = RecyclerView(activity).apply {
            layoutManager = LinearLayoutManager(activity)
            itemAnimator = null
            descendantFocusability = ViewGroup.FOCUS_AFTER_DESCENDANTS
            adapter = Rows(100)
        }
        categories = list()
        content = list()
        root.addView(categories, LinearLayout.LayoutParams(300, 400))
        root.addView(content, LinearLayout.LayoutParams(600, 400))
        activity.setContentView(root)
        layout()
    }

    @After fun cleanup() {
        controller.pause().stop().destroy()
        shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(600))
    }

    private fun layout() {
        root.measure(View.MeasureSpec.makeMeasureSpec(900, View.MeasureSpec.EXACTLY),
            View.MeasureSpec.makeMeasureSpec(400, View.MeasureSpec.EXACTLY))
        root.layout(0, 0, 900, 400)
    }

    private fun settle() {
        repeat(5) {
            layout()
            shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(20))
        }
    }

    private fun position(list: RecyclerView): Int = list.findFocus()
        ?.takeUnless { it === list }?.let(list::findContainingViewHolder)
        ?.bindingAdapterPosition ?: RecyclerView.NO_POSITION

    private fun press(key: Int) = TwoPaneFocusGuard.handle(
        KeyEvent(KeyEvent.ACTION_DOWN, key), categories, content,
        { TwoPaneFocusGuard.focusItem(categories, 1) },
        { TwoPaneFocusGuard.focusItem(content, 1) }
    )

    @Test fun offscreenRequestRetainsCurrentRowUntilTargetAttaches() {
        assertTrue(TwoPaneFocusGuard.focusItem(categories, 2))
        assertTrue(TwoPaneFocusGuard.focusItem(categories, 40))
        // Preserve the current row during layout instead of moving focus to the container or row 0.
        assertEquals(2, position(categories))
        settle()
        assertEquals(40, position(categories))
    }

    @Test fun repeatedDownBeforeLayoutContinuesFromPendingPosition() {
        TwoPaneFocusGuard.focusItem(categories, 2)
        TwoPaneFocusGuard.focusItem(categories, 40)
        repeat(5) { assertTrue(press(KeyEvent.KEYCODE_DPAD_DOWN)) }
        settle()
        assertEquals(45, position(categories))
        assertFalse(content.hasFocus())
    }

    @Test fun reversingDirectionBeforeLayoutDoesNotResetToTop() {
        TwoPaneFocusGuard.focusItem(categories, 40)
        assertTrue(press(KeyEvent.KEYCODE_DPAD_UP))
        assertTrue(press(KeyEvent.KEYCODE_DPAD_UP))
        settle()
        assertEquals(38, position(categories))
    }

    @Test fun changingPaneCancelsOldDeferredFocus() {
        TwoPaneFocusGuard.focusItem(categories, 40)
        assertTrue(press(KeyEvent.KEYCODE_DPAD_RIGHT))
        settle()
        shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(600))
        assertEquals(1, position(content))
        assertFalse(categories.hasFocus())
    }

    @Test fun newerVisibleRequestWinsOverAnOffscreenRequest() {
        TwoPaneFocusGuard.focusItem(categories, 40)
        TwoPaneFocusGuard.focusItem(categories, 1)
        settle()
        shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(600))
        assertEquals(1, position(categories))
    }

    @Test fun allHundredCategoriesRemainReachableInBothDirections() {
        TwoPaneFocusGuard.focusItem(categories, 0)
        for (expected in 1..99) {
            assertTrue(press(KeyEvent.KEYCODE_DPAD_DOWN))
            settle()
            assertEquals("Down to $expected", expected, position(categories))
        }
        press(KeyEvent.KEYCODE_DPAD_DOWN)
        settle()
        assertEquals(99, position(categories))
        for (expected in 98 downTo 0) {
            assertTrue(press(KeyEvent.KEYCODE_DPAD_UP))
            settle()
            assertEquals("Up to $expected", expected, position(categories))
        }
    }

    private class Rows(private val count: Int) : RecyclerView.Adapter<Row>() {
        init { setHasStableIds(true) }
        override fun getItemId(position: Int) = position.toLong()
        override fun getItemCount() = count
        override fun onCreateViewHolder(parent: ViewGroup, viewType: Int) = Row(TextView(parent.context).apply {
            isFocusable = true
            isFocusableInTouchMode = true
            layoutParams = RecyclerView.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 80)
        })
        override fun onBindViewHolder(holder: Row, position: Int) { (holder.itemView as TextView).text = "Category $position" }
    }
    private class Row(view: View) : RecyclerView.ViewHolder(view)
}
