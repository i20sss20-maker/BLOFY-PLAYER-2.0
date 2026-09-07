package tv.blofy.player.ui.home

import android.app.Activity
import android.app.Application
import android.view.Gravity
import android.view.KeyEvent
import android.view.View
import android.widget.Button
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ScrollView
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.android.controller.ActivityController
import org.robolectric.annotation.Config
import org.robolectric.annotation.LooperMode

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28], application = Application::class)
@LooperMode(LooperMode.Mode.PAUSED)
class HomeFocusControllerRegressionTest {
    private lateinit var activityController: ActivityController<Activity>
    private lateinit var activity: Activity
    private lateinit var root: FrameLayout
    private lateinit var sidebar: LinearLayout
    private lateinit var feed: LinearLayout
    private lateinit var navigation: HomeFocusController
    private val actions = linkedMapOf<String, View>()
    private var time = 1000L

    @Before fun setup() {
        activityController = Robolectric.buildActivity(Activity::class.java).setup().visible()
        activity = activityController.get()
        root = FrameLayout(activity)
        sidebar = LinearLayout(activity).apply { orientation = LinearLayout.VERTICAL }
        listOf("side_live", "side_movies", "side_series").forEach { key ->
            val button = button(key)
            actions[key] = button
            sidebar.addView(button, LinearLayout.LayoutParams(180, 70))
        }
        root.addView(sidebar, FrameLayout.LayoutParams(200, 700, Gravity.LEFT or Gravity.TOP))
        val scroll = ScrollView(activity)
        feed = LinearLayout(activity).apply { orientation = LinearLayout.VERTICAL }
        scroll.addView(feed, FrameLayout.LayoutParams(1000, -2))
        root.addView(scroll, FrameLayout.LayoutParams(1000, 700, Gravity.LEFT or Gravity.TOP).apply { leftMargin = 220 })
        addRow("hero_watch", "hero_movies")
        addRow("poster_latest_movie_0", "poster_latest_movie_1")
        addRow("poster_top_movie_0", "poster_top_movie_1")
        activity.setContentView(root)
        navigation = HomeFocusController(root, sidebar, feed) { actions }
        layout()
    }

    @After fun cleanup() { navigation.dispose(); activityController.pause().stop().destroy() }

    private fun button(label: String) = Button(activity).apply {
        id = View.generateViewId(); text = label; isFocusable = true; isFocusableInTouchMode = true
    }
    private fun addRow(right: String, left: String): FrameLayout {
        val row = FrameLayout(activity).apply { layoutDirection = View.LAYOUT_DIRECTION_RTL }
        listOf(right to 750, left to 500).forEach { (key, x) ->
            val button = button(key); actions[key] = button
            row.addView(button, FrameLayout.LayoutParams(160, 90, Gravity.LEFT or Gravity.TOP).apply { leftMargin = x })
        }
        feed.addView(row, LinearLayout.LayoutParams(1000, 180))
        return row
    }
    private fun layout() {
        root.measure(View.MeasureSpec.makeMeasureSpec(1280, View.MeasureSpec.EXACTLY), View.MeasureSpec.makeMeasureSpec(720, View.MeasureSpec.EXACTLY))
        root.layout(0, 0, 1280, 720)
        root.viewTreeObserver.dispatchOnGlobalLayout()
    }
    private fun focus(key: String) { assertTrue(checkNotNull(actions[key]).requestFocus()) }
    private fun focused(key: String) { assertSame(key, actions[key], root.findFocus()) }
    private fun tap(code: Int) {
        time += 10
        assertTrue(navigation.handle(KeyEvent(time, time, KeyEvent.ACTION_DOWN, code, 0)))
        assertTrue(navigation.handle(KeyEvent(time, time + 1, KeyEvent.ACTION_UP, code, 0)))
    }

    @Test fun allFourArrowsHaveOneOwnerAndSidebarRoundTripRetainsCurrentCard() {
        focus("hero_watch")
        tap(KeyEvent.KEYCODE_DPAD_LEFT); focused("hero_movies")
        tap(KeyEvent.KEYCODE_DPAD_DOWN); focused("poster_latest_movie_1")
        tap(KeyEvent.KEYCODE_DPAD_UP); focused("hero_movies")
        tap(KeyEvent.KEYCODE_DPAD_LEFT); focused("side_movies")
        tap(KeyEvent.KEYCODE_DPAD_RIGHT); focused("hero_movies")
        tap(KeyEvent.KEYCODE_DPAD_RIGHT); focused("hero_watch")
    }
    @Test fun rapidSeparateTapsAreNotDroppedOrQueued() {
        focus("side_live")
        tap(KeyEvent.KEYCODE_DPAD_DOWN); focused("side_movies")
        tap(KeyEvent.KEYCODE_DPAD_DOWN); focused("side_series")
        tap(KeyEvent.KEYCODE_DPAD_DOWN); focused("side_series")
    }
    @Test fun hiddenRowCannotReceiveFocusThroughAStaleActionMap() {
        focus("hero_movies")
        feed.getChildAt(1).visibility = View.GONE
        layout()
        tap(KeyEvent.KEYCODE_DPAD_DOWN); focused("poster_top_movie_1")
    }
    @Test fun disabledCardIsSkipped() {
        focus("hero_watch")
        actions["hero_movies"]!!.isEnabled = false
        tap(KeyEvent.KEYCODE_DPAD_LEFT); focused("side_live")
    }
    @Test fun injectedWatchlistRowWorksWithoutRegistration() {
        val row = FrameLayout(activity)
        val card = button("watchlist")
        row.addView(card, FrameLayout.LayoutParams(160, 90).apply { leftMargin = 500 })
        feed.addView(row, 1, LinearLayout.LayoutParams(1000, 180))
        layout(); focus("hero_movies")
        tap(KeyEvent.KEYCODE_DPAD_DOWN); assertSame(card, root.findFocus())
        tap(KeyEvent.KEYCODE_DPAD_DOWN); focused("poster_latest_movie_1")
    }
    @Test fun rowsFollowActualReorderedHierarchy() {
        focus("hero_movies")
        val bottom = feed.getChildAt(2)
        feed.removeView(bottom); feed.addView(bottom, 1)
        layout()
        tap(KeyEvent.KEYCODE_DPAD_DOWN); focused("poster_top_movie_1")
    }
    @Test fun visualAnimationDoesNotChangeLeftRightOrder() {
        focus("hero_watch")
        actions["hero_watch"]!!.apply { translationX = -900f; scaleX = 1.1f; scaleY = 1.1f }
        tap(KeyEvent.KEYCODE_DPAD_LEFT); focused("hero_movies")
    }
    @Test fun rowRefreshWithIdenticalViewsIsANoopAndKeepsFocus() {
        focus("poster_latest_movie_1")
        val order = (0 until feed.childCount).map(feed::getChildAt)
        repeat(5) { assertFalse(HomeRowReconciler.apply(feed, order)) }
        focused("poster_latest_movie_1")
    }
    @Test fun actualRowReorderKeepsTheSameFocusedView() {
        focus("poster_latest_movie_1")
        val order = listOf(feed.getChildAt(0), feed.getChildAt(2), feed.getChildAt(1))
        assertTrue(HomeRowReconciler.apply(feed, order))
        layout(); focused("poster_latest_movie_1")
    }
    @Test fun okBackAndMenuAreNotInterceptedAndDisposeIsSafe() {
        listOf(KeyEvent.KEYCODE_DPAD_CENTER, KeyEvent.KEYCODE_BACK, KeyEvent.KEYCODE_MENU).forEach {
            assertFalse(navigation.handle(KeyEvent(KeyEvent.ACTION_DOWN, it)))
        }
        navigation.dispose()
        assertFalse(navigation.handle(KeyEvent(KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_DPAD_DOWN)))
    }
}
