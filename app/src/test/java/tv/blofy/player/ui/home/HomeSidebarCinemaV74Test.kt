package tv.blofy.player.ui.home

import android.app.Application
import android.graphics.Color
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import tv.blofy.player.R
import tv.blofy.player.core.device.DeviceClass

/** The branded TV navigation rail must stay usable in Arabic and on 540dp TVs. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28], application = Application::class, qualifiers = "ar-rSA-w960dp-h540dp-land-xhdpi")
class HomeSidebarCinemaV74Test {
    @Test fun eightAccessibleIconActionsKeepTheirStableDpadTags() {
        val activity = home()
        val root = buildTvHome(activity)
        val tags = listOf(
            "side_home", "side_live", "side_movies", "side_series",
            "side_collections", "side_favorites", "side_search", "side_settings"
        )
        val rows = tags.map { tag ->
            root.findViewWithTag<LinearLayout>(tag).also { row ->
                assertNotNull("Missing navigation action: $tag", row)
                assertTrue("$tag must be focusable", row.isFocusable)
                assertTrue("$tag must be clickable", row.isClickable)
                assertFalse("$tag must be named for accessibility", row.contentDescription.isNullOrBlank())
                assertEquals(View.LAYOUT_DIRECTION_RTL, row.layoutDirection)
                val iconTile = row.getChildAt(0) as FrameLayout
                assertEquals("blofy_side_icon_tile", iconTile.tag)
                val icon = iconTile.getChildAt(0) as ImageView
                assertNotNull("$tag must use a proper vector drawable", icon.drawable)
                assertEquals(View.IMPORTANT_FOR_ACCESSIBILITY_NO, icon.importantForAccessibility)
                assertTrue((row.getChildAt(1) as android.widget.TextView).text.isNotBlank())
            }
        }
        assertEquals(8, rows.size)
    }

    @Test fun selectingActionBrightensItsIconWithoutRemovingLabels() {
        val activity = home()
        val root = buildTvHome(activity)
        val action = root.findViewWithTag<LinearLayout>("side_movies")
        val tile = action.getChildAt(0) as FrameLayout
        val icon = tile.getChildAt(0) as ImageView
        val normal = icon.imageTintList?.defaultColor
        action.onFocusChangeListener.onFocusChange(action, true)
        assertEquals(Color.WHITE, icon.imageTintList?.defaultColor)
        assertNotEquals(normal, icon.imageTintList?.defaultColor)
        assertNotNull(action.background)
        assertEquals(activity.getString(R.string.home_movies), action.contentDescription)
        action.onFocusChangeListener.onFocusChange(action, false)
        assertEquals(normal, icon.imageTintList?.defaultColor)
    }

    @Test fun sidebarFits540dpLandscapeWithoutNeedingAnInitialScroll() {
        val activity = home()
        val root = buildTvHome(activity)
        val d = activity.resources.displayMetrics.density
        val width = (960 * d).toInt()
        val height = (540 * d).toInt()
        root.measure(
            View.MeasureSpec.makeMeasureSpec(width, View.MeasureSpec.EXACTLY),
            View.MeasureSpec.makeMeasureSpec(height, View.MeasureSpec.EXACTLY)
        )
        root.layout(0, 0, width, height)
        val rail = root.findViewWithTag<ScrollView>("blofy_home_rail")
        val body = rail.getChildAt(0) as ViewGroup
        assertTrue("Rail actions must fit the visible TV", body.height <= rail.height)
        assertEquals(0, rail.scrollY)
    }

    private fun home(): HomeActivity = Robolectric.buildActivity(HomeActivity::class.java).get().also {
        it.setTheme(R.style.Theme_Blofy)
        HomeActivity::class.java.getDeclaredField("deviceKind").apply {
            isAccessible = true
        }.set(it, DeviceClass.Kind.TV)
    }

    private fun buildTvHome(activity: HomeActivity): ViewGroup =
        HomeActivity::class.java.getDeclaredMethod("buildTvHome").apply {
            isAccessible = true
        }.invoke(activity) as ViewGroup
}
