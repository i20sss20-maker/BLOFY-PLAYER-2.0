package tv.blofy.player.ui.browser

import android.app.Application
import android.graphics.Bitmap
import android.graphics.drawable.BitmapDrawable
import android.os.Looper
import android.widget.FrameLayout
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okio.Buffer
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.annotation.LooperMode
import tv.blofy.player.data.local.StreamEntity
import tv.blofy.player.ui.catalog.ArtworkLoader
import java.io.ByteArrayOutputStream
import java.util.concurrent.TimeUnit

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28], application = Application::class)
@LooperMode(LooperMode.Mode.PAUSED)
class LiveChannelArtworkTest {
    @Test fun cachedChannelHolderResumesItsFallbackImageWithoutAnotherBind() {
        ArtworkLoader.clearMemory()
        val bytes = ByteArrayOutputStream().also {
            Bitmap.createBitmap(32, 32, Bitmap.Config.ARGB_8888).compress(Bitmap.CompressFormat.PNG, 100, it)
        }.toByteArray()
        val server = MockWebServer().apply {
            enqueue(MockResponse().setBody(Buffer().write(bytes))); start()
        }
        val adapter = LiveChannelAdapter({}, {}, {}, { it.key })
        adapter.replace(listOf(StreamEntity("p:live:1", "p", "1", null, "live", "Fixture", icon = " ",
            backdrop = server.url("/logo").toString())))
        val holder = adapter.onCreateViewHolder(FrameLayout(RuntimeEnvironment.getApplication()), 0)
        try {
            adapter.onBindViewHolder(holder, 0)
            adapter.onViewDetachedFromWindow(holder)
            assertNull(holder.logo.tag)
            adapter.onViewAttachedToWindow(holder)
            val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(4)
            while (holder.logo.drawable !is BitmapDrawable && System.nanoTime() < deadline) {
                shadowOf(Looper.getMainLooper()).idle(); Thread.sleep(10)
            }
            assertTrue(holder.logo.drawable is BitmapDrawable)
            assertEquals(1, server.requestCount)
        } finally { adapter.onViewRecycled(holder); server.shutdown() }
    }
}
