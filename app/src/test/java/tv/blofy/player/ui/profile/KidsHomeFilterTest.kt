package tv.blofy.player.ui.profile

import android.app.Application
import android.view.View
import android.widget.LinearLayout
import android.widget.TextView
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28], application = Application::class)
class KidsHomeFilterTest {
    private val context get() = RuntimeEnvironment.getApplication()
    private fun card(label: String) = LinearLayout(context).apply {
        isFocusable = true
        isFocusableInTouchMode = true
        isClickable = true
        addView(TextView(context).apply { text = label })
    }

    @Test fun filtersCardsAddedAfterHomeResumeAndRestoresThemForAdult() {
        var kids = true
        val root = LinearLayout(context)
        val filter = KidsHomeFilter(root) { kids }
        filter.attach()
        val blocked = card("Adults only 18+")
        val safe = card("Family movie")
        root.addView(blocked)
        root.addView(safe)
        root.viewTreeObserver.dispatchOnGlobalLayout()
        assertEquals(View.GONE, blocked.visibility)
        assertFalse(blocked.isFocusable)
        assertEquals(View.VISIBLE, safe.visibility)
        kids = false
        root.viewTreeObserver.dispatchOnGlobalLayout()
        assertEquals(View.VISIBLE, blocked.visibility)
        assertTrue(blocked.isFocusable)
        assertTrue(blocked.isFocusableInTouchMode)
        filter.detach()
    }

    @Test fun adultResumeRestoresStateLeftByPreviousKidsLifecycleBinding() {
        val root = LinearLayout(context)
        val blocked = card("18+ movie")
        root.addView(blocked)
        KidsHomeFilter(root) { true }.apply { attach(); detach() }
        assertEquals(View.GONE, blocked.visibility)
        val adult = KidsHomeFilter(root) { false }
        adult.attach()
        assertEquals(View.VISIBLE, blocked.visibility)
        assertTrue(blocked.isFocusable)
        adult.detach()
    }

    @Test fun filterNeverRestoresViewsHiddenByAnotherFeature() {
        val root = LinearLayout(context)
        val hidden = card("18+ movie").apply { visibility = View.GONE }
        root.addView(hidden)
        KidsHomeFilter(root) { true }.apply { attach(); detach() }
        KidsHomeFilter(root) { false }.apply { attach(); detach() }
        assertEquals(View.GONE, hidden.visibility)
    }

    @Test fun asyncTitleChangeIsFilteredAndDetachedObserverDoesNotKeepProcessing() {
        val root = LinearLayout(context)
        val tile = card("Loading")
        root.addView(tile)
        val filter = KidsHomeFilter(root) { true }
        filter.attach()
        (tile.getChildAt(0) as TextView).text = "Adults only"
        root.viewTreeObserver.dispatchOnGlobalLayout()
        assertEquals(View.GONE, tile.visibility)
        filter.detach()
        val later = card("18+ movie")
        root.addView(later)
        root.viewTreeObserver.dispatchOnGlobalLayout()
        assertEquals(View.VISIBLE, later.visibility)
    }

    @Test fun focusableScrollContainerDoesNotHideTheEntireMixedShelf() {
        val root = LinearLayout(context)
        val shelf = android.widget.HorizontalScrollView(context).apply { isFocusable = true }
        val row = LinearLayout(context)
        val blocked = card("18+ movie")
        val safe = card("Family movie")
        row.addView(blocked)
        row.addView(safe)
        shelf.addView(row)
        root.addView(shelf)
        val filter = KidsHomeFilter(root) { true }
        filter.attach()
        assertEquals(View.VISIBLE, shelf.visibility)
        assertEquals(View.VISIBLE, safe.visibility)
        assertEquals(View.GONE, blocked.visibility)
        filter.detach()
    }
}
