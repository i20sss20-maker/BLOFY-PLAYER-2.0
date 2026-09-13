package tv.blofy.player.ui.browser

import android.app.Application
import android.content.Intent
import android.graphics.Rect
import android.view.View
import android.view.ViewGroup
import android.widget.TextView
import androidx.annotation.OptIn
import androidx.media3.common.util.UnstableApi
import androidx.media3.ui.AspectRatioFrameLayout
import androidx.media3.ui.PlayerView
import androidx.recyclerview.widget.RecyclerView
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import tv.blofy.player.R
import tv.blofy.player.core.device.DeviceClass
import tv.blofy.player.data.local.StreamEntity
import tv.blofy.player.data.local.ProviderEntity
import tv.blofy.player.ui.settings.RuntimeSettings

/** Measure the actual browser views without provider loading, network requests, or a decoder. */
@RunWith(RobolectricTestRunner::class)
@OptIn(markerClass = [UnstableApi::class])
@Config(sdk = [28], application = Application::class, qualifiers = "en-w960dp-h540dp-land-xhdpi")
class LivePreviewLayoutTest {
    @Test fun fullHdTvKeepsAllThreePanesAndReadableChannelNames() {
        val (activity, root) = build(DeviceClass.Kind.TV)
        checkThreePanes(root, 960, 540)
        val channels = root.findViewWithTag<RecyclerView>("blofy_live_channels")
        val adapter = LiveChannelAdapter({}, {}, {}, { it.key })
        adapter.submit(listOf(StreamEntity("test:1", "test", "1", null, "live", "AR: A long HD channel name")))
        val holder = adapter.onCreateViewHolder(channels, 0)
        adapter.onBindViewHolder(holder, 0)
        val row = holder.itemView
        row.measure(exact(channels.width - channels.paddingLeft - channels.paddingRight), exact(row.layoutParams.height))
        row.layout(0, 0, row.measuredWidth, row.measuredHeight)
        assertTrue(row.isFocusable)
        assertTrue("Channel names need useful width next to the logo and badge", holder.title.width >= 100 * activity.resources.displayMetrics.density)
        assertTrue("Two title lines must fit", holder.title.height >= holder.title.lineHeight * 2)
        assertTrue(bounds(row, holder.title).bottom <= row.height)
    }

    @Test
    @Config(sdk = [23], qualifiers = "en-w720dp-h405dp-land-xhdpi")
    fun compactTvOnMinimumAndroidVersionKeepsItsPreview() = checkThreePanes(build(DeviceClass.Kind.TV).second, 720, 405)

    @Test
    @Config(qualifiers = "ar-rSA-w1280dp-h720dp-land-xhdpi")
    fun wideArabicTvKeepsItsPreview() = checkThreePanes(build(DeviceClass.Kind.TV).second, 1280, 720)

    @Test
    @Config(qualifiers = "en-w1280dp-h800dp-land-xhdpi")
    fun landscapeTabletKeepsItsPreview() = checkThreePanes(build(DeviceClass.Kind.TABLET).second, 1280, 800)

    @Test
    @Config(qualifiers = "en-w600dp-h960dp-port-xhdpi")
    fun portraitTabletKeepsUsableCategoryAndChannelLists() = checkWithoutPreview(build(DeviceClass.Kind.TABLET).second, 600, 960, false)

    @Test
    @Config(qualifiers = "en-w360dp-h800dp-port-xhdpi")
    fun portraitPhoneStacksCategoriesAboveChannels() = checkWithoutPreview(build(DeviceClass.Kind.PHONE).second, 360, 800, true)

    @Test
    @Config(qualifiers = "en-w800dp-h360dp-land-xhdpi")
    fun landscapePhoneKeepsTheTouchLayout() = checkWithoutPreview(build(DeviceClass.Kind.PHONE).second, 800, 360, true)

    @Test fun manualPlaybackPreferenceStillDisablesAutoplayPreview() = checkWithoutPreview(build(DeviceClass.Kind.TV, false).second, 960, 540, false)

    @Test fun allChannelsRestoresTheSavedChannelAcrossReturningFromPlayback() {
        val (activity, _) = build(DeviceClass.Kind.TV)
        ContentBrowserActivity::class.java.getDeclaredField("provider").apply { isAccessible = true }
            .set(activity, ProviderEntity("test", "Test", "https://example.test", "user", "pass"))
        val method = ContentBrowserActivity::class.java.getDeclaredMethod("canRestorePreview", StreamEntity::class.java).apply { isAccessible = true }
        val channel = StreamEntity("test:1", "test", "1", "sports", "live", "Channel")
        fun allowed(stream: StreamEntity) = method.invoke(activity, stream) as Boolean
        assertTrue("All Channels includes channels belonging to a provider category", allowed(channel))
        assertFalse(allowed(channel.copy(providerId = "other")))
        assertFalse(allowed(channel.copy(locked = true)))
        assertFalse(allowed(channel.copy(kind = "movie")))
        ContentBrowserActivity::class.java.getDeclaredField("currentCategoryId").apply { isAccessible = true }.set(activity, "news")
        assertFalse(allowed(channel))
        assertTrue(allowed(channel.copy(categoryId = "news")))
    }

    private fun build(kind: DeviceClass.Kind, autoplay: Boolean = true): Pair<ContentBrowserActivity, View> {
        val activity = Robolectric.buildActivity(ContentBrowserActivity::class.java, Intent().putExtra(ContentBrowserActivity.EXTRA_KIND, "live")).get()
        activity.setTheme(R.style.Theme_Blofy)
        ContentBrowserActivity::class.java.getDeclaredField("deviceKind\$delegate").apply { isAccessible = true }.set(activity, lazyOf(kind))
        activity.getSharedPreferences(RuntimeSettings.PREFS, 0).edit().putString(RuntimeSettings.KEY_AUTOPLAY_LIVE, if (autoplay) "on" else "off").commit()
        val root = ContentBrowserActivity::class.java.getDeclaredMethod("buildBrowserUi").apply { isAccessible = true }.invoke(activity) as View
        return activity to root
    }

    private fun checkThreePanes(root: View, widthDp: Int, heightDp: Int) {
        layout(root, widthDp, heightDp)
        val heading = root.findViewWithTag<TextView>("blofy_browser_heading")
        assertEquals(root.resources.configuration.layoutDirection, heading.layoutDirection)
        assertTrue("Heading reserves the search shortcut's trailing area", heading.paddingEnd >= 178 * root.resources.displayMetrics.density)
        val categories = root.findViewWithTag<View>("blofy_live_categories")
        val channels = root.findViewWithTag<View>("blofy_live_channels")
        val preview = root.findViewWithTag<ViewGroup>("blofy_live_preview")
        assertNotNull("Live preview must not disappear on a 1080p TV", preview)
        val frame = Rect(0, 0, root.width, root.height)
        listOf(categories, channels, preview).forEach { assertTrue(frame.contains(bounds(root, it))) }
        assertTrue(bounds(root, categories).right <= bounds(root, channels).left)
        assertTrue(bounds(root, channels).right <= bounds(root, preview).left)
        assertTrue("Preview remains useful", preview.width >= 260 * root.resources.displayMetrics.density)
        val player = (0 until preview.childCount).map(preview::getChildAt).filterIsInstance<PlayerView>().single()
        assertTrue(player.width > 0 && player.height > 0)
        assertFalse(player.isFocusable)
        assertEquals(AspectRatioFrameLayout.RESIZE_MODE_FIT, player.resizeMode)
    }

    private fun checkWithoutPreview(root: View, widthDp: Int, heightDp: Int, stacked: Boolean) {
        layout(root, widthDp, heightDp)
        assertNull(root.findViewWithTag<View>("blofy_live_preview"))
        val categories = bounds(root, root.findViewWithTag("blofy_live_categories"))
        val channels = bounds(root, root.findViewWithTag("blofy_live_channels"))
        assertTrue(Rect(0, 0, root.width, root.height).contains(channels))
        assertTrue(channels.width() > 200 * root.resources.displayMetrics.density)
        assertTrue(channels.height() > 120 * root.resources.displayMetrics.density)
        if (stacked) assertTrue(categories.bottom <= channels.top) else assertTrue(categories.right <= channels.left)
    }

    private fun exact(value: Int) = View.MeasureSpec.makeMeasureSpec(value, View.MeasureSpec.EXACTLY)
    private fun layout(root: View, widthDp: Int, heightDp: Int) {
        val density = root.resources.displayMetrics.density
        root.measure(exact((widthDp * density).toInt()), exact((heightDp * density).toInt()))
        root.layout(0, 0, root.measuredWidth, root.measuredHeight)
    }
    private fun bounds(root: View, view: View): Rect = Rect(0, 0, view.width, view.height).also {
        (root as ViewGroup).offsetDescendantRectToMyCoords(view, it)
    }
}
