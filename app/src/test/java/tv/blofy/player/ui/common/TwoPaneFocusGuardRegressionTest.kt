package tv.blofy.player.ui.common

import android.app.Activity
import android.app.Application
import android.os.Looper
import android.view.KeyEvent
import android.view.View
import android.view.ViewGroup
import android.widget.LinearLayout
import android.widget.TextView
import androidx.recyclerview.widget.GridLayoutManager
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

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28], application = Application::class)
@LooperMode(LooperMode.Mode.PAUSED)
class TwoPaneFocusGuardRegressionTest {
    private lateinit var controller: ActivityController<Activity>
    private lateinit var activity: Activity
    private lateinit var root: LinearLayout
    private lateinit var categories: RecyclerView
    private lateinit var content: RecyclerView
    private var categoryEntries = 0
    private var contentEntries = 0

    @Before fun setup() {
        controller = Robolectric.buildActivity(Activity::class.java).setup().visible()
        activity = controller.get()
        root = LinearLayout(activity).apply {
            orientation = LinearLayout.HORIZONTAL
            layoutDirection = View.LAYOUT_DIRECTION_LTR
        }
        fun list() = RecyclerView(activity).apply {
            layoutManager = LinearLayoutManager(activity)
            itemAnimator = null
            adapter = Rows(3)
            descendantFocusability = ViewGroup.FOCUS_AFTER_DESCENDANTS
            layoutDirection = View.LAYOUT_DIRECTION_LTR
        }
        categories = list()
        content = list()
        root.addView(categories, LinearLayout.LayoutParams(320, 600))
        root.addView(content, LinearLayout.LayoutParams(640, 600))
        activity.setContentView(root)
        layout()
    }

    @After fun cleanup() { controller.pause().stop().destroy() }

    private fun layout() {
        root.measure(View.MeasureSpec.makeMeasureSpec(960, View.MeasureSpec.EXACTLY),
            View.MeasureSpec.makeMeasureSpec(600, View.MeasureSpec.EXACTLY))
        root.layout(0, 0, 960, 600)
    }

    private fun row(list: RecyclerView, index: Int): View =
        checkNotNull(list.findViewHolderForAdapterPosition(index)).itemView

    private fun press(code: Int, action: Int = KeyEvent.ACTION_DOWN): Boolean =
        TwoPaneFocusGuard.handle(KeyEvent(action, code), categories, content,
            { categoryEntries++; TwoPaneFocusGuard.focusItem(categories, 1) },
            { contentEntries++; TwoPaneFocusGuard.focusItem(content, 1) })

    @Test fun upAtFirstCategoryCannotJumpToContent() {
        row(categories, 0).requestFocus()
        assertTrue(press(KeyEvent.KEYCODE_DPAD_UP))
        assertTrue(row(categories, 0).hasFocus())
        assertFalse(content.hasFocus())
        assertEquals(0, contentEntries)
    }

    @Test fun downAtLastCategoryCannotJumpToContent() {
        row(categories, 2).requestFocus()
        assertTrue(press(KeyEvent.KEYCODE_DPAD_DOWN))
        assertTrue(row(categories, 2).hasFocus())
        assertFalse(content.hasFocus())
    }

    @Test fun contentVerticalEdgesCannotJumpToCategories() {
        row(content, 0).requestFocus()
        assertTrue(press(KeyEvent.KEYCODE_DPAD_UP))
        assertTrue(row(content, 0).hasFocus())
        row(content, 2).requestFocus()
        assertTrue(press(KeyEvent.KEYCODE_DPAD_DOWN))
        assertTrue(row(content, 2).hasFocus())
        assertFalse(categories.hasFocus())
        assertEquals(0, categoryEntries)
    }

    @Test fun downMovesWithinWhicheverListOwnsFocus() {
        row(categories, 0).requestFocus()
        press(KeyEvent.KEYCODE_DPAD_DOWN)
        assertTrue(row(categories, 1).hasFocus())
        row(content, 1).requestFocus()
        press(KeyEvent.KEYCODE_DPAD_DOWN)
        assertTrue(row(content, 2).hasFocus())
        assertFalse(categories.hasFocus())
    }

    @Test fun rightTransfersFocusOnceAndOldListLosesFocus() {
        row(categories, 1).requestFocus()
        assertTrue(press(KeyEvent.KEYCODE_DPAD_RIGHT))
        assertTrue(row(content, 1).hasFocus())
        assertFalse(categories.hasFocus())
        assertEquals(1, contentEntries)
        assertFalse(press(KeyEvent.KEYCODE_DPAD_RIGHT, KeyEvent.ACTION_UP))
        assertEquals(1, contentEntries)
    }

    @Test fun leftReturnsToTheExplicitCategoryNotNearestUnrelatedRow() {
        row(content, 2).requestFocus()
        assertTrue(press(KeyEvent.KEYCODE_DPAD_LEFT))
        assertTrue(row(categories, 1).hasFocus())
        assertFalse(content.hasFocus())
        assertEquals(1, categoryEntries)
    }

    @Test fun emptyDestinationKeepsOriginalFocusInsteadOfGlobalFallback() {
        content.adapter = Rows(0)
        layout()
        row(categories, 1).requestFocus()
        assertTrue(press(KeyEvent.KEYCODE_DPAD_RIGHT))
        assertTrue(row(categories, 1).hasFocus())
        assertFalse(content.hasFocus())
    }

    @Test fun okAndBackAreNotIntercepted() {
        row(content, 1).requestFocus()
        assertFalse(press(KeyEvent.KEYCODE_DPAD_CENTER))
        assertFalse(press(KeyEvent.KEYCODE_BACK))
        assertTrue(row(content, 1).hasFocus())
    }

    @Test fun gridMovesWithinRowBeforeSwitchingPaneInLtr() {
        content.layoutManager = GridLayoutManager(activity, 3)
        content.adapter = Rows(5)
        layout()
        row(content, 1).requestFocus()
        press(KeyEvent.KEYCODE_DPAD_LEFT)
        assertTrue(row(content, 0).hasFocus())
        assertEquals(0, categoryEntries)
        press(KeyEvent.KEYCODE_DPAD_LEFT)
        assertTrue(categories.hasFocus())
        assertEquals(1, categoryEntries)
    }

    @Test fun gridMovesWithinRowBeforeSwitchingPaneInRtl() {
        content.layoutDirection = View.LAYOUT_DIRECTION_RTL
        content.layoutManager = GridLayoutManager(activity, 3)
        content.adapter = Rows(5)
        layout()
        row(content, 0).requestFocus()
        press(KeyEvent.KEYCODE_DPAD_LEFT)
        assertTrue(row(content, 1).hasFocus())
        press(KeyEvent.KEYCODE_DPAD_LEFT)
        assertTrue(row(content, 2).hasFocus())
        assertEquals(0, categoryEntries)
        press(KeyEvent.KEYCODE_DPAD_LEFT)
        assertTrue(categories.hasFocus())
    }

    @Test fun partialRowsAndVariableColumnCountsHavePhysicalEdges() {
        for (columns in listOf(2, 3, 4, 5, 6, 7)) {
            val count = columns + 1
            assertTrue(TwoPaneFocusGuard.isLeftEdge(0, count, columns, false))
            assertFalse(TwoPaneFocusGuard.isLeftEdge(1, count, columns, false))
            assertTrue(TwoPaneFocusGuard.isLeftEdge(columns - 1, count, columns, true))
            assertTrue(TwoPaneFocusGuard.isLeftEdge(columns, count, columns, true))
            assertNull(TwoPaneFocusGuard.horizontalNeighbor(columns - 1, count, columns, false, false))
            assertNull(TwoPaneFocusGuard.horizontalNeighbor(columns, count, columns, true, true))
            assertEquals(1, TwoPaneFocusGuard.horizontalNeighbor(0, count, columns, false, false))
            assertEquals(1, TwoPaneFocusGuard.horizontalNeighbor(0, count, columns, true, true))
        }
    }

    @Test fun invalidAndStaleGridPositionsDoNotEscape() {
        assertFalse(TwoPaneFocusGuard.isLeftEdge(-1, 3, 2, false))
        assertFalse(TwoPaneFocusGuard.isLeftEdge(0, 0, 2, true))
        assertNull(TwoPaneFocusGuard.horizontalNeighbor(10, 3, 2, true, false))
        assertNull(TwoPaneFocusGuard.horizontalNeighbor(0, 3, 0, true, false))
    }

    @Test fun deferredOffscreenRequestDoesNotStealFocusAfterUserMoves() {
        categories.adapter = Rows(40)
        layout()
        row(content, 0).requestFocus()
        assertTrue(TwoPaneFocusGuard.focusItem(categories, 29))
        row(content, 1).requestFocus()
        layout()
        shadowOf(Looper.getMainLooper()).idle()
        assertTrue(row(content, 1).hasFocus())
        assertFalse(categories.hasFocus())
    }

    private class Rows(private val count: Int) : RecyclerView.Adapter<Row>() {
        init { setHasStableIds(true) }
        override fun getItemId(position: Int) = position.toLong()
        override fun getItemCount() = count
        override fun onCreateViewHolder(parent: ViewGroup, type: Int) = Row(TextView(parent.context).apply {
            isFocusable = true
            isFocusableInTouchMode = true
            layoutParams = RecyclerView.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 100)
        })
        override fun onBindViewHolder(holder: Row, position: Int) { (holder.itemView as TextView).text = "$position" }
    }
    private class Row(view: View) : RecyclerView.ViewHolder(view)
}
