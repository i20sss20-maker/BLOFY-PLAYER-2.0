package tv.blofy.player.ui.catalog

import android.app.Application
import android.graphics.Bitmap
import android.graphics.drawable.BitmapDrawable
import android.os.Looper
import android.widget.ImageView
import kotlinx.coroutines.runBlocking
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
import java.util.concurrent.Executors
import java.util.concurrent.ThreadPoolExecutor
import java.util.concurrent.TimeUnit

/** Controlled blocked resources, not timing claims about customer devices. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28], application = Application::class)
@LooperMode(LooperMode.Mode.PAUSED)
class ArtworkThroughputTest {
    private val app get() = RuntimeEnvironment.getApplication()
    private val bytes get() = ByteArrayOutputStream().also {
        Bitmap.createBitmap(16, 24, Bitmap.Config.ARGB_8888).compress(Bitmap.CompressFormat.PNG, 100, it)
    }.toByteArray()
    private fun image() = MockResponse().setBody(Buffer().write(bytes)).setHeader("Content-Type", "image/png")
    private fun await(label: String, seconds: Long = 3, condition: () -> Boolean) {
        val end = System.nanoTime() + TimeUnit.SECONDS.toNanos(seconds)
        do {
            shadowOf(Looper.getMainLooper()).idle()
            if (condition()) return
            Thread.sleep(10)
        } while (System.nanoTime() < end)
        fail(label)
    }
    private fun workers(): Int = (ArtworkLoader::class.java.getDeclaredField("networkPool")
        .apply { isAccessible = true }.get(ArtworkLoader) as ThreadPoolExecutor).corePoolSize

    @Test fun missingPrimaryIsNotDownloadedTwiceBeforeTryingBackdrop() {
        ArtworkLoader.clearMemory()
        val server = MockWebServer().apply {
            dispatcher = object : Dispatcher() {
                override fun dispatch(request: RecordedRequest) =
                    if (request.path == "/missing") MockResponse().setResponseCode(404) else image()
            }
            start()
        }
        val view = ImageView(app)
        try {
            ArtworkLoader.load(view, listOf(server.url("/missing").toString(), server.url("/fallback").toString()))
            await("The valid fallback must appear") { view.drawable is BitmapDrawable }
            assertEquals("A terminal HTTP error must not be retried", 2, server.requestCount)
        } finally { ArtworkLoader.cancel(view); server.shutdown() }
    }

    @Test fun fastVisiblePosterBypassesEarlierSlowPostersWhileNetworkCapacityIsAvailable() {
        ArtworkLoader.clearMemory()
        val count = if (workers() <= 4) 2 else 4
        val started = CountDownLatch(count)
        val release = CountDownLatch(1)
        val server = MockWebServer().apply {
            dispatcher = object : Dispatcher() {
                override fun dispatch(request: RecordedRequest): MockResponse {
                    if (request.path!!.startsWith("/slow")) {
                        started.countDown(); release.await(10, TimeUnit.SECONDS)
                    }
                    return image()
                }
            }; start()
        }
        val slow = List(count) { ImageView(app) }
        val fresh = ImageView(app)
        try {
            slow.forEachIndexed { i, view -> ArtworkLoader.load(view, server.url("/slow-$i").toString()) }
            await("Slow requests must be active") { started.count == 0L }
            ArtworkLoader.load(fresh, server.url("/fast").toString())
            await("An unrelated fast poster must not wait behind slow responses") { fresh.drawable is BitmapDrawable }
            assertEquals(1L, release.count)
        } finally {
            release.countDown(); slow.forEach(ArtworkLoader::cancel); ArtworkLoader.cancel(fresh); server.shutdown()
        }
    }

    @Test fun fullLibraryDownloadsCannotOccupyEveryVisibleNetworkSlot() {
        ArtworkLoader.clearMemory()
        val release = CountDownLatch(1)
        val started = CountDownLatch(1)
        val server = MockWebServer().apply {
            dispatcher = object : Dispatcher() {
                override fun dispatch(request: RecordedRequest): MockResponse {
                    if (request.path!!.startsWith("/library")) {
                        started.countDown(); release.await(10, TimeUnit.SECONDS)
                    }
                    return image()
                }
            }; start()
        }
        val executor = Executors.newFixedThreadPool(workers())
        val fresh = ImageView(app)
        val tasks = List(workers()) { i -> executor.submit<Boolean> {
            runBlocking { ArtworkLoader.persist(app, server.url("/library-$i").toString()) }
        } }
        try {
            assertTrue(started.await(3, TimeUnit.SECONDS))
            // Let all already-submitted background workers enter their queue.
            Thread.sleep(300)
            ArtworkLoader.load(fresh, server.url("/visible").toString())
            await("Visible artwork must load while library responses are blocked") { fresh.drawable is BitmapDrawable }
            assertEquals(1L, release.count)
        } finally {
            release.countDown(); tasks.forEach { it.get(10, TimeUnit.SECONDS) }
            executor.shutdownNow(); ArtworkLoader.cancel(fresh); server.shutdown()
        }
    }

    @Test fun decodedPosterAppearsBeforeItsDurableWriteCanFinish() {
        ArtworkLoader.clearMemory()
        val started = CountDownLatch(1)
        val sendResponse = CountDownLatch(1)
        val server = MockWebServer().apply {
            dispatcher = object : Dispatcher() {
                override fun dispatch(request: RecordedRequest): MockResponse {
                    started.countDown(); sendResponse.await(8, TimeUnit.SECONDS); return image()
                }
            }; start()
        }
        val view = ImageView(app)
        val url = server.url("/slow-storage").toString()
        val lock = ArtworkLoader::class.java.getDeclaredMethod("fileLock", String::class.java)
            .apply { isAccessible = true }.invoke(ArtworkLoader, url)
        try {
            ArtworkLoader.load(view, url)
            await("The local miss must reach the network first") { started.count == 0L }
            synchronized(lock) {
                sendResponse.countDown()
                await("Decoded image must be displayed without waiting for storage") { view.drawable is BitmapDrawable }
            }
            await("Image must still be saved durably") { ArtworkLoader.isPersisted(app, url) }
        } finally { sendResponse.countDown(); ArtworkLoader.cancel(view); server.shutdown() }
    }
}
