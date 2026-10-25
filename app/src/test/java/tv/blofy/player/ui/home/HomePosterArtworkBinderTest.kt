package tv.blofy.player.ui.home

import android.app.Activity
import android.app.Application
import android.os.Looper
import android.widget.FrameLayout
import android.widget.ImageView
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.annotation.LooperMode
import java.time.Duration

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28], application = Application::class)
@LooperMode(LooperMode.Mode.PAUSED)
class HomePosterArtworkBinderTest {
    @Test fun offscreenShelvesDoNotQueueNetworkUntilTheyEnterViewport() {
        val controller = Robolectric.buildActivity(Activity::class.java).setup().visible()
        try {
            val activity = controller.get()
            val root = FrameLayout(activity)
            activity.setContentView(root)
            val near = ImageView(activity)
            val far = ImageView(activity)
            root.addView(near)
            root.addView(far)
            val visible = linkedSetOf(near)
            val loaded = mutableListOf<ImageView>()
            val binder = HomePosterArtworkBinder(root,
                load = { view, _ -> loaded.add(view) },
                cancel = { },
                visible = { it in visible }
            )
            binder.stage(near, listOf("https://example.com/near.jpg"))
            binder.stage(far, listOf("https://example.com/far.jpg"))
            binder.onViewportChanged()
            shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(33))
            assertEquals(listOf(near), loaded)
            visible.add(far)
            binder.onViewportChanged()
            shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(33))
            assertEquals(listOf(near, far), loaded)
            binder.onViewportChanged()
            shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(33))
            assertEquals(2, loaded.size)
            binder.clear()
        } finally { controller.pause().stop().destroy() }
    }

    @Test fun focusGivesUnloadedPosterPriorityAndClearCancelsExistingRequests() {
        val controller = Robolectric.buildActivity(Activity::class.java).setup().visible()
        try {
            val activity = controller.get()
            val root = FrameLayout(activity)
            activity.setContentView(root)
            val focused = ImageView(activity)
            val other = ImageView(activity)
            root.addView(focused)
            root.addView(other)
            val loaded = mutableListOf<ImageView>()
            val cancelled = mutableListOf<ImageView>()
            val binder = HomePosterArtworkBinder(root,
                load = { view, _ -> loaded.add(view) },
                cancel = { cancelled.add(it) },
                visible = { false }
            )
            binder.stage(focused, listOf("https://example.com/1.jpg"))
            binder.stage(other, listOf("https://example.com/2.jpg"))
            binder.focus(focused)
            binder.focus(focused)
            assertEquals(listOf(focused), loaded)
            binder.clear()
            assertEquals(listOf(focused), cancelled)
        } finally { controller.pause().stop().destroy() }
    }

    @Test fun visibleImagesBindInSmallBatchesInsteadOfOneHeavyFrame() {
        val controller = Robolectric.buildActivity(Activity::class.java).setup().visible()
        try {
            val activity = controller.get()
            val root = FrameLayout(activity)
            activity.setContentView(root)
            val loaded = mutableListOf<ImageView>()
            val binder = HomePosterArtworkBinder(root,
                load = { view, _ -> loaded.add(view) },
                cancel = {},
                visible = { true }
            )
            repeat(23) {
                val image = ImageView(activity)
                root.addView(image)
                binder.stage(image, listOf("https://example.com/$it.jpg"))
            }
            binder.onViewportChanged()
            shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(100))
            assertEquals(23, loaded.size)
            assertEquals(23, loaded.distinct().size)
            binder.clear()
        } finally { controller.pause().stop().destroy() }
    }
}
