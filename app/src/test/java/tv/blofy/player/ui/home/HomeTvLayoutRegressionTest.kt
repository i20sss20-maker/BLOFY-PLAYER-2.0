package tv.blofy.player.ui.home

import android.app.Application
import android.graphics.Rect
import android.os.Looper
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.FrameLayout
import android.widget.HorizontalScrollView
import android.widget.LinearLayout
import android.widget.TextView
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.annotation.LooperMode
import tv.blofy.player.R
import tv.blofy.player.core.device.DeviceClass
import tv.blofy.player.data.local.StreamEntity
import java.time.Duration

/** Real Home views at the emulator's 540dp height, without catalog/network startup. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28], application = Application::class, qualifiers = "en-w960dp-h540dp-land-xhdpi")
@LooperMode(LooperMode.Mode.PAUSED)
class HomeTvLayoutRegressionTest {
    @Test fun heroDoesNotChangeTheSelectedActionWhileTheRemoteIsOnItsButtons() {
        val activity = Robolectric.buildActivity(HomeActivity::class.java).get()
        activity.setTheme(R.style.Theme_Blofy)
        HomeActivity::class.java.getDeclaredField("deviceKind").apply { isAccessible = true }
            .set(activity, DeviceClass.Kind.TV)
        val root = call(activity, "buildTvHome") as FrameLayout
        activity.setContentView(root)
        val items = listOf("First", "Second").mapIndexed { index, name ->
            StreamEntity("hero:$index", "test", "$index", "movies", "movie", name)
        }
        HomeActivity::class.java.getDeclaredField("heroCandidates").apply { isAccessible = true }.set(activity, items)
        call(activity, "renderHero", items.first())
        val primary = field<Button>(activity, "heroPrimary")
        assertTrue(primary.requestFocus())
        assertTrue(field<View>(activity, "heroContent").hasFocus())
        val scheduler = field<HomeRefreshScheduler>(activity, "refreshScheduler")
        scheduler.start()
        try {
            shadowOf(Looper.getMainLooper()).idleFor(Duration.ofSeconds(16))
            assertEquals("First", field<TextView>(activity, "heroTitle").text.toString())
            primary.clearFocus()
            root.isFocusableInTouchMode = true
            root.requestFocus()
            shadowOf(Looper.getMainLooper()).idleFor(Duration.ofSeconds(8))
            assertEquals("Second", field<TextView>(activity, "heroTitle").text.toString())
        } finally { scheduler.stop() }
    }

    @Test fun englishRailAndLongHeroFitAndRevealTheNextShelf() = checkLayout(false)

    @Test
    @Config(qualifiers = "ar-rSA-w960dp-h540dp-land-xhdpi")
    fun arabicRailAndLongHeroFitAndMirrorTheEnglishLayout() = checkLayout(true)

    @Test
    @Config(qualifiers = "ar-rSA-w960dp-h540dp-land-xhdpi")
    fun arabicRankingStartsAtOneAndKeepsPositionWhenProfileReordersRows() {
        val activity = Robolectric.buildActivity(HomeActivity::class.java).get()
        activity.setTheme(R.style.Theme_Blofy)
        val feed = LinearLayout(activity).apply { orientation = LinearLayout.VERTICAL }
        val items = (1..10).map { StreamEntity("rank:$it", "test", "$it", "movies", "movie", "Movie $it") }
        call(activity, "addTopTenShelf", feed, "test", items)
        fun layout() {
            feed.measure(View.MeasureSpec.makeMeasureSpec(1500, View.MeasureSpec.EXACTLY),
                View.MeasureSpec.makeMeasureSpec(500, View.MeasureSpec.EXACTLY))
            feed.layout(0, 0, 1500, 500)
        }
        layout()
        val scroll = descendants(feed).filterIsInstance<HorizontalScrollView>().single()
        val first = feed.findViewWithTag<View>("rank:1")
        assertTrue("Arabic ranking must initially expose item one", bounds(feed, scroll).contains(bounds(feed, first)))
        val offset = scroll.scrollX
        feed.removeView(scroll)
        feed.addView(scroll)
        layout()
        assertEquals("Reattaching the row must not invert the RTL scroll position", offset, scroll.scrollX)
        assertTrue(bounds(feed, scroll).contains(bounds(feed, first)))
    }

    private fun checkLayout(rtl: Boolean) {
        // Build only the presentation: no onCreate, provider lookup, player, or network access.
        val activity = Robolectric.buildActivity(HomeActivity::class.java).get()
        activity.setTheme(R.style.Theme_Blofy)
        HomeActivity::class.java.getDeclaredField("deviceKind").apply { isAccessible = true }
            .set(activity, DeviceClass.Kind.TV)
        val root = call(activity, "buildTvHome") as FrameLayout
        val heroTitle = field<TextView>(activity, "heroTitle")
        heroTitle.text = if (rtl) "عنوان مسلسل طويل لاختبار التفاف النص دون إخفاء أزرار المشاهدة أو قص المحتوى"
            else "A long series title that wraps across two lines without hiding the watch controls"
        field<TextView>(activity, "heroMeta").text = "2026   •   ★ 8.5   •   Drama / Adventure / Science Fiction   •   4K"
        field<TextView>(activity, "heroSubtitle").text = "A long description stays within the hero panel and leaves space for its buttons."
        val feed = field<LinearLayout>(activity, "homeFeed")
        val sample = StreamEntity("test:movie:1", "test", "1", "movies", "movie", "A sample movie")
        call(activity, "addShelf", feed, "Recently added", "From your library", "latest", "test", listOf(sample), emptyMap<String, Any>())
        val density = activity.resources.displayMetrics.density
        val width = (960 * density).toInt()
        val height = (540 * density).toInt()
        root.measure(View.MeasureSpec.makeMeasureSpec(width, View.MeasureSpec.EXACTLY),
            View.MeasureSpec.makeMeasureSpec(height, View.MeasureSpec.EXACTLY))
        root.layout(0, 0, width, height)
        val rail = root.findViewWithTag<View>("blofy_home_rail")
        val hero = root.findViewWithTag<View>("blofy_home_hero")
        val railBounds = bounds(root, rail)
        val heroBounds = bounds(root, hero)
        assertEquals(rtl, railBounds.centerX() > heroBounds.centerX())
        listOf("side_live", "side_movies", "side_series", "side_collections", "side_favorites", "side_search", "side_settings").forEach { key ->
            val item = root.findViewWithTag<View>(key)
            assertNotNull(key, item)
            assertTrue("$key must be fully inside the visible rail", railBounds.contains(bounds(root, item)))
            assertTrue("$key remains reachable by remote", item.isFocusable)
        }
        val heroButtons = descendants(hero).filterIsInstance<Button>()
        assertEquals(2, heroButtons.size)
        heroButtons.forEach { button ->
            assertTrue("Watch buttons must fit beneath a wrapped title", heroBounds.contains(bounds(root, button)))
            assertTrue("Button text must fit vertically", button.height - button.compoundPaddingTop - button.compoundPaddingBottom >= button.lineHeight)
        }
        assertTrue(heroBounds.contains(bounds(root, heroTitle)))
        val nextCard = descendants(feed).first { it.tag == sample.key }
        assertTrue("Entry should show at least 80dp of the next shelf", bounds(root, nextCard).top < height - (80 * density).toInt())
    }

    private fun bounds(root: ViewGroup, view: View) = Rect(view.scrollX, view.scrollY,
        view.scrollX + view.width, view.scrollY + view.height).also { root.offsetDescendantRectToMyCoords(view, it) }

    private fun descendants(view: View): List<View> = listOf(view) +
        if (view is ViewGroup) (0 until view.childCount).flatMap { descendants(view.getChildAt(it)) } else emptyList()

    private fun call(activity: HomeActivity, name: String, vararg args: Any): Any? =
        HomeActivity::class.java.declaredMethods.first { it.name == name && it.parameterCount == args.size }
            .apply { isAccessible = true }.invoke(activity, *args)

    @Suppress("UNCHECKED_CAST")
    private fun <T> field(activity: HomeActivity, name: String): T =
        HomeActivity::class.java.getDeclaredField(name).apply { isAccessible = true }.get(activity) as T
}
