package tv.blofy.player.ui.catalog

import android.app.Application
import android.graphics.Bitmap
import android.graphics.drawable.BitmapDrawable
import android.os.Looper
import android.widget.FrameLayout
import android.widget.ImageView
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
import java.io.ByteArrayOutputStream
import java.util.concurrent.TimeUnit

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28], application = Application::class)
@LooperMode(LooperMode.Mode.PAUSED)
class PosterStreamArtworkTest {
    @Test fun cachedMovieDetailPosterReplacesBluePlaceholderWithoutCatalogIcon() {
        ArtworkLoader.clearMemory()
        val bytes = ByteArrayOutputStream().also {
            Bitmap.createBitmap(30, 46, Bitmap.Config.ARGB_8888)
                .compress(Bitmap.CompressFormat.PNG, 100, it)
        }.toByteArray()
        val server = MockWebServer().apply {
            enqueue(MockResponse().setBody(Buffer().write(bytes))
                .setHeader("Content-Type", "image/png")); start()
        }
        val key = "p:movie:2026"
        // A provider may omit stream_icon and later supply a valid poster via
        // get_vod_info. Only the already saved detail URL is needed to render.
        val url = server.url("/movie-poster.png").toString()
        val adapter = PosterStreamAdapter(onClick = {})
        adapter.rememberArtworkUrls(mapOf(key to listOf(url)), reset = true)
        adapter.replace(listOf(StreamEntity(
            key, "p", "2026", "1", "movie", "Posterless Xtream movie", icon = null
        )))
        val holder = adapter.onCreateViewHolder(FrameLayout(RuntimeEnvironment.getApplication()), 0)
        try {
            adapter.onBindViewHolder(holder, 0)
            val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(5)
            while (holder.image.drawable !is BitmapDrawable && System.nanoTime() < deadline) {
                shadowOf(Looper.getMainLooper()).idle()
                Thread.sleep(10)
            }
            assertTrue("Saved detail poster must be drawn over the placeholder",
                holder.image.drawable is BitmapDrawable)
            assertEquals(1, server.requestCount)
        } finally { adapter.onViewRecycled(holder); server.shutdown() }
    }

    @Test fun artworkUrlContainingUnescapedSpacesIsEncodedForHttpFetch() {
        ArtworkLoader.clearMemory()
        val bytes = ByteArrayOutputStream().also {
            Bitmap.createBitmap(20, 30, Bitmap.Config.ARGB_8888)
                .compress(Bitmap.CompressFormat.PNG, 100, it)
        }.toByteArray()
        val server = MockWebServer().apply {
            enqueue(MockResponse().setBody(Buffer().write(bytes))
                .setHeader("Content-Type", "image/png")); start()
        }
        val url = server.url("/poster%20name.png").toString().replace("%20", " ")
        val image = ImageView(RuntimeEnvironment.getApplication())
        try {
            ArtworkLoader.load(image, url)
            val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(5)
            while (image.drawable !is BitmapDrawable && System.nanoTime() < deadline) {
                shadowOf(Looper.getMainLooper()).idle()
                Thread.sleep(10)
            }
            assertTrue("Unescaped spaces must not silently drop the image URL",
                image.drawable is BitmapDrawable)
            assertEquals("/poster%20name.png", server.takeRequest().path)
        } finally { ArtworkLoader.cancel(image); server.shutdown() }
    }

    @Test fun blankIconUsesBackdropAndCachedHolderReloadsWhenReattachedWithoutRebinding() {
        ArtworkLoader.clearMemory()
        val bytes = ByteArrayOutputStream().also {
            Bitmap.createBitmap(16, 24, Bitmap.Config.ARGB_8888).compress(Bitmap.CompressFormat.PNG, 100, it)
        }.toByteArray()
        val server = MockWebServer().apply {
            enqueue(MockResponse().setBody(Buffer().write(bytes)).setHeader("Content-Type", "image/png")); start()
        }
        val url = server.url("/backdrop.png").toString()
        val adapter = PosterStreamAdapter(onClick = {})
        adapter.replace(listOf(StreamEntity("p:live:1", "p", "1", null, "live", "Channel", icon = " ", backdrop = url)))
        val holder = adapter.onCreateViewHolder(FrameLayout(RuntimeEnvironment.getApplication()), 0)
        try {
            adapter.onBindViewHolder(holder, 0)
            adapter.onViewDetachedFromWindow(holder)
            assertNull(holder.image.tag)
            adapter.onViewAttachedToWindow(holder)
            val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(5)
            while (holder.image.drawable !is BitmapDrawable && System.nanoTime() < deadline) {
                shadowOf(Looper.getMainLooper()).idle(); Thread.sleep(10)
            }
            assertTrue("A cached holder must resume its cancelled artwork request", holder.image.drawable is BitmapDrawable)
            assertEquals("Channel logos should remain fully visible", ImageView.ScaleType.FIT_CENTER, holder.image.scaleType)
            assertEquals(1, server.requestCount)
        } finally { adapter.onViewRecycled(holder); server.shutdown() }
    }
}
