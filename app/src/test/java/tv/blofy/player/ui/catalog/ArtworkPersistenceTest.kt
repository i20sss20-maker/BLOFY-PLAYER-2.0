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
import java.io.File
import java.security.MessageDigest
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.ThreadPoolExecutor
import java.util.concurrent.TimeUnit

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28], application = Application::class)
@LooperMode(LooperMode.Mode.PAUSED)
class ArtworkPersistenceTest {
    private val app get() = RuntimeEnvironment.getApplication()
    private fun png() = ByteArrayOutputStream().also {
        Bitmap.createBitmap(16, 24, Bitmap.Config.ARGB_8888).compress(Bitmap.CompressFormat.PNG, 100, it)
    }.toByteArray()
    private fun image() = MockResponse().setHeader("Content-Type", "image/png").setBody(Buffer().write(png()))
    private fun await(label: String, condition: () -> Boolean) {
        val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(5)
        do {
            shadowOf(Looper.getMainLooper()).idle()
            if (condition()) return
            Thread.sleep(10)
        } while (System.nanoTime() < deadline)
        fail("Timed out: $label")
    }

    @Test fun displayedPosterSurvivesMemoryAndTemporaryCacheClearingWithoutAnotherRequest() {
        ArtworkLoader.clearMemory()
        val server = MockWebServer().apply { enqueue(image()); start() }
        val url = server.url("/retained.png").toString()
        val first = ImageView(app)
        val second = ImageView(app)
        try {
            ArtworkLoader.load(first, url)
            await("initial poster and durable write") { first.drawable is BitmapDrawable && ArtworkLoader.isPersisted(app, url) }
            assertEquals(1, server.requestCount)
            ArtworkLoader.cancel(first)
            ArtworkLoader.clearMemory()
            File(app.cacheDir, "blofy_posters").deleteRecursively()
            server.enqueue(MockResponse().setResponseCode(503))
            ArtworkLoader.load(second, url)
            await("poster from permanent storage") { second.drawable is BitmapDrawable }
            assertEquals("Reopening must not re-download the poster", 1, server.requestCount)
        } finally {
            ArtworkLoader.cancel(first); ArtworkLoader.cancel(second); server.shutdown()
        }
    }

    @Test fun cancelledVisibleLoadAndDurableSyncShareOneDownloadAndKeepItsResult() {
        ArtworkLoader.clearMemory()
        val started = CountDownLatch(1)
        val release = CountDownLatch(1)
        val server = MockWebServer().apply {
            dispatcher = object : Dispatcher() {
                override fun dispatch(request: RecordedRequest): MockResponse {
                    started.countDown(); release.await(5, TimeUnit.SECONDS)
                    return image()
                }
            }
            start()
        }
        val executor = Executors.newSingleThreadExecutor()
        val url = server.url("/shared.png").toString()
        val view = ImageView(app)
        try {
            ArtworkLoader.load(view, url)
            await("network request") { started.count == 0L }
            val sync = executor.submit<Boolean> { runBlocking { ArtworkLoader.persist(app, url) } }
            ArtworkLoader.cancel(view)
            release.countDown()
            assertTrue(sync.get(5, TimeUnit.SECONDS))
            await("durable cached result") { ArtworkLoader.isPersisted(app, url) }
            ArtworkLoader.clearMemory()
            ArtworkLoader.load(view, url)
            await("rebound poster") { view.drawable is BitmapDrawable }
            assertEquals("Visible requests and background sync must coalesce", 1, server.requestCount)
        } finally {
            release.countDown(); ArtworkLoader.cancel(view); executor.shutdownNow(); server.shutdown()
        }
    }

    @Test fun localPosterDoesNotWaitBehindUncancelledSlowVisibleRequests() {
        ArtworkLoader.clearMemory()
        val pool = ArtworkLoader::class.java.getDeclaredField("networkPool").apply { isAccessible = true }
            .get(ArtworkLoader) as ThreadPoolExecutor
        val slowStarted = CountDownLatch(pool.corePoolSize)
        val release = CountDownLatch(1)
        val server = MockWebServer().apply {
            dispatcher = object : Dispatcher() {
                override fun dispatch(request: RecordedRequest): MockResponse {
                    if (request.path?.startsWith("/slow") == true) {
                        slowStarted.countDown(); release.await(8, TimeUnit.SECONDS)
                    }
                    return image()
                }
            }
            start()
        }
        val local = ImageView(app)
        val slow = List(pool.corePoolSize) { ImageView(app) }
        val url = server.url("/local.png").toString()
        try {
            assertTrue(runBlocking { ArtworkLoader.persist(app, url) })
            ArtworkLoader.clearMemory()
            slow.forEachIndexed { index, view -> ArtworkLoader.load(view, server.url("/slow-$index.png").toString()) }
            await("slow requests occupy network slots") { slowStarted.count == 0L }
            ArtworkLoader.load(local, url)
            await("disk hit bypasses blocked network waits") { local.drawable is BitmapDrawable }
            assertEquals("Slow HTTP responses should still be blocked", 1L, release.count)
        } finally {
            release.countDown(); slow.forEach(ArtworkLoader::cancel); ArtworkLoader.cancel(local); server.shutdown()
        }
    }

    @Test fun legacyQualityCacheIsReusedAndPromotedInsteadOfDownloadedAgain() {
        ArtworkLoader.clearMemory()
        val server = MockWebServer().apply { start() }
        val url = server.url("/old-cache.png").toString()
        val hash = MessageDigest.getInstance("SHA-256").digest("$url@280".toByteArray())
            .joinToString("") { "%02x".format(it) }
        File(File(app.cacheDir, "blofy_posters").apply { mkdirs() }, "$hash.jpg").writeBytes(png())
        val view = ImageView(app)
        try {
            ArtworkLoader.load(view, url)
            await("legacy poster is visible and retained") { view.drawable is BitmapDrawable && ArtworkLoader.isPersisted(app, url) }
            assertEquals(0, server.requestCount)
        } finally { ArtworkLoader.cancel(view); server.shutdown() }
    }

    @Test fun oversizedOriginalIsCompactedAndStillReopensOffline() {
        ArtworkLoader.clearMemory()
        val random = java.util.Random(17)
        val bitmap = Bitmap.createBitmap(1024, 1536, Bitmap.Config.RGB_565).apply {
            setPixels(IntArray(1024 * 1536) { random.nextInt() or 0xFF000000.toInt() }, 0, 1024, 0, 0, 1024, 1536)
        }
        val original = ByteArrayOutputStream().also { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }.toByteArray()
        assertTrue(original.size > 384 * 1024)
        val server = MockWebServer().apply { enqueue(MockResponse().setBody(Buffer().write(original))); start() }
        val url = server.url("/large-source.png").toString()
        val view = ImageView(app)
        try {
            assertTrue(runBlocking { ArtworkLoader.persist(app, url) })
            val id = MessageDigest.getInstance("SHA-256").digest(url.toByteArray()).joinToString("") { "%02x".format(it) }
            val file = File(File(File(app.filesDir, "blofy_library_art"), id.take(2)), "$id.jpg")
            assertTrue("Permanent artwork should not retain a multi-megabyte original", file.length() < original.size / 2)
            ArtworkLoader.clearMemory()
            ArtworkLoader.load(view, url)
            await("Compacted image is decoded from permanent storage") { view.drawable is BitmapDrawable }
            assertEquals(1, server.requestCount)
        } finally { ArtworkLoader.cancel(view); server.shutdown() }
    }
}
