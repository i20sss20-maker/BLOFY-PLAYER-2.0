package tv.blofy.player.ui.catalog

import android.app.Application
import android.graphics.Bitmap
import android.graphics.drawable.BitmapDrawable
import android.os.Looper
import android.widget.ImageView
import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import okio.Buffer
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.annotation.LooperMode
import java.io.ByteArrayOutputStream
import java.util.concurrent.CountDownLatch
import java.util.concurrent.ThreadPoolExecutor
import java.util.concurrent.TimeUnit

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28], application = Application::class)
@LooperMode(LooperMode.Mode.PAUSED)
class ArtworkCancellationTest {
    @Test fun recycledViewsReleaseCoordinatorWaitsForNewVisibleImages() {
        ArtworkLoader.clearMemory()
        val pool = ArtworkLoader::class.java.getDeclaredField("coordinatorPool").apply { isAccessible = true }
            .get(ArtworkLoader) as ThreadPoolExecutor
        val oldStarted = CountDownLatch(pool.corePoolSize)
        val releaseOld = CountDownLatch(1)
        val png = ByteArrayOutputStream().also {
            Bitmap.createBitmap(8, 8, Bitmap.Config.ARGB_8888).compress(Bitmap.CompressFormat.PNG, 100, it)
        }.toByteArray()
        val server = MockWebServer().apply {
            dispatcher = object : Dispatcher() {
                override fun dispatch(request: RecordedRequest): MockResponse {
                    if (request.path?.startsWith("/old-") == true) {
                        oldStarted.countDown()
                        releaseOld.await(10, TimeUnit.SECONDS)
                    }
                    return MockResponse().setHeader("Content-Type", "image/png").setBody(Buffer().write(png))
                }
            }
            start()
        }
        val views = List(pool.corePoolSize) { ImageView(RuntimeEnvironment.getApplication()) }
        val fresh = ImageView(RuntimeEnvironment.getApplication())
        try {
            views.forEachIndexed { index, view -> ArtworkLoader.load(view, server.url("/old-$index.png").toString()) }
            assertTrue("Old requests must occupy each coordinator before recycling", oldStarted.await(5, TimeUnit.SECONDS))
            views.forEach(ArtworkLoader::cancel)
            ArtworkLoader.load(fresh, server.url("/fresh.png").toString())
            val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(3)
            while (fresh.drawable !is BitmapDrawable && System.nanoTime() < deadline) {
                shadowOf(Looper.getMainLooper()).idle()
                Thread.sleep(10)
            }
            assertTrue("A fresh visible image must load while obsolete server responses remain blocked", fresh.drawable is BitmapDrawable)
            assertEquals(1L, releaseOld.count)
        } finally {
            releaseOld.countDown()
            views.forEach(ArtworkLoader::cancel)
            ArtworkLoader.cancel(fresh)
            server.shutdown()
        }
    }
}
