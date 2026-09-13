package tv.blofy.player.ui.home

import android.app.Activity
import android.app.Application
import android.graphics.Rect
import android.os.Looper
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.annotation.LooperMode
import tv.blofy.player.R
import tv.blofy.player.core.device.DeviceClass
import tv.blofy.player.data.local.StreamEntity
import tv.blofy.player.ui.search.SearchActivity

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28], application = Application::class)
@LooperMode(LooperMode.Mode.PAUSED)
class HomeAdaptiveLayoutTest {
    @Test fun phoneAndSplitScreenKeepHeroActionsAndNavigationWithinWindow() {
        for (locale in listOf("en", "ar-rSA")) for (width in listOf(320, 360, 412, 540)) {
            RuntimeEnvironment.setQualifiers("$locale-w${width}dp-h800dp-port-xhdpi")
            val activity = home(DeviceClass.Kind.PHONE)
            val root = call(activity, "buildCompactHome") as ViewGroup
            val title = field<TextView>(activity, "heroTitle")
            title.text = "عنوان طويل جدًا لاختبار بقاء أزرار المشاهدة داخل حدود الشاشة في كل المقاسات"
            val feed = field<LinearLayout>(activity, "homeFeed")
            val sample = StreamEntity("sample:1", "test", "1", "movies", "movie", "Sample")
            call(activity, "addShelf", feed, "Continue watching", "", "continue", "test", listOf(sample), emptyMap<String, Any>())
            measure(root, width, 800)
            val hero = root.findViewWithTag<ViewGroup>("blofy_home_hero")
            val heroBounds = bounds(root, hero)
            val buttons = descendants(hero).filterIsInstance<Button>()
            assertEquals(2, buttons.size)
            buttons.forEach { button ->
                assertTrue("$locale $width: primary controls must remain reachable", heroBounds.contains(bounds(root, button)))
                assertTrue(button.height >= dp(activity, 48))
            }
            val bottom = root.findViewWithTag<ViewGroup>("blofy_home_bottom_nav")
            assertTrue(Rect(0, 0, root.width, root.height).contains(bounds(root, bottom)))
            assertEquals(4, bottom.childCount)
            val card = root.findViewWithTag<View>(sample.key)
            assertTrue("Continue watching uses landscape art", card.width > card.height)
            val search = root.findViewWithTag<View>("mobile_search")
            assertTrue(search.width >= dp(activity, 48) && search.height >= dp(activity, 48))
        }
    }

    @Test fun tabletRailMirrorsWithoutHidingHeroActions() {
        for (locale in listOf("en", "ar-rSA")) for (width in listOf(600, 840, 1280)) {
            RuntimeEnvironment.setQualifiers("$locale-w${width}dp-h900dp-xhdpi")
            val activity = home(DeviceClass.Kind.TABLET)
            val root = call(activity, "buildTvHome") as ViewGroup
            measure(root, width, 900)
            val rail = bounds(root, root.findViewWithTag<View>("blofy_home_rail"))
            val hero = root.findViewWithTag<ViewGroup>("blofy_home_hero")
            assertEquals(locale == "ar-rSA", rail.centerX() > bounds(root, hero).centerX())
            descendants(hero).filterIsInstance<Button>().forEach {
                assertTrue("Tablet $width: controls fit hero", bounds(root, hero).contains(bounds(root, it)))
                assertTrue(it.height >= dp(activity, 48))
            }
            assertNull(root.findViewWithTag<View>("blofy_home_bottom_nav"))
        }
    }

    @Test fun searchOpensWithOneTouch() {
        RuntimeEnvironment.setQualifiers("ar-rSA-w360dp-h800dp-port-xhdpi")
        val activity = home(DeviceClass.Kind.PHONE)
        val root = call(activity, "buildCompactHome") as ViewGroup
        // Attach the real Home view to a visible window so Android can post its click.
        // A plain host avoids starting Home's unrelated catalog/network lifecycle.
        val host = Robolectric.buildActivity(Activity::class.java).setup().visible()
        host.get().setContentView(root)
        shadowOf(Looper.getMainLooper()).idle()
        measure(root, 360, 800)
        val search = root.findViewWithTag<View>("mobile_search")
        val down = MotionEvent.obtain(0, 0, MotionEvent.ACTION_DOWN, search.width / 2f, search.height / 2f, 0)
        val up = MotionEvent.obtain(0, 40, MotionEvent.ACTION_UP, search.width / 2f, search.height / 2f, 0)
        try {
            assertTrue("Touch target must be attached to a window", search.isAttachedToWindow)
            search.dispatchTouchEvent(down)
            search.dispatchTouchEvent(up)
            shadowOf(Looper.getMainLooper()).idle()
            assertEquals(SearchActivity::class.java.name, shadowOf(activity).nextStartedActivity?.component?.className)
        } finally {
            down.recycle(); up.recycle()
            host.pause().stop().destroy()
        }
    }

    private fun home(kind: DeviceClass.Kind): HomeActivity = Robolectric.buildActivity(HomeActivity::class.java).get().apply {
        setTheme(R.style.Theme_Blofy)
        HomeActivity::class.java.getDeclaredField("deviceKind").apply { isAccessible = true }.set(this, kind)
    }
    private fun dp(activity: HomeActivity, value: Int) = (value * activity.resources.displayMetrics.density).toInt()
    private fun measure(root: View, width: Int, height: Int) {
        val density = root.resources.displayMetrics.density
        val w = (width * density).toInt(); val h = (height * density).toInt()
        root.measure(View.MeasureSpec.makeMeasureSpec(w, View.MeasureSpec.EXACTLY), View.MeasureSpec.makeMeasureSpec(h, View.MeasureSpec.EXACTLY))
        root.layout(0, 0, w, h)
    }
    private fun bounds(root: ViewGroup, view: View) = Rect(view.scrollX, view.scrollY, view.scrollX + view.width, view.scrollY + view.height)
        .also { root.offsetDescendantRectToMyCoords(view, it) }
    private fun descendants(view: View): List<View> = listOf(view) + if (view is ViewGroup) (0 until view.childCount).flatMap { descendants(view.getChildAt(it)) } else emptyList()
    private fun call(activity: HomeActivity, name: String, vararg args: Any): Any? = HomeActivity::class.java.declaredMethods
        .first { it.name == name && it.parameterCount == args.size }.apply { isAccessible = true }.invoke(activity, *args)
    @Suppress("UNCHECKED_CAST")
    private fun <T> field(activity: HomeActivity, name: String): T = HomeActivity::class.java.getDeclaredField(name).apply { isAccessible = true }.get(activity) as T
}
