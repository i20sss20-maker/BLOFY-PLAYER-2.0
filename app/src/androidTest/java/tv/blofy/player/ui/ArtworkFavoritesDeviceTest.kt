package tv.blofy.player.ui

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.drawable.BitmapDrawable
import android.os.SystemClock
import android.view.KeyEvent
import android.view.View
import android.view.ViewGroup
import androidx.recyclerview.widget.RecyclerView
import androidx.room.Room
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking
import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import okio.Buffer
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import tv.blofy.player.data.local.BlofyDatabase
import tv.blofy.player.data.local.ProviderEntity
import tv.blofy.player.data.local.StreamEntity
import tv.blofy.player.ui.catalog.ArtworkLoader
import tv.blofy.player.ui.catalog.PosterStreamAdapter
import tv.blofy.player.ui.library.LibraryActivity
import java.io.ByteArrayOutputStream
import java.io.File

/** The workflow runs these methods in separate app processes, with the fixture server stopped. */
@RunWith(AndroidJUnit4::class)
class ArtworkFavoritesDeviceTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val context = instrumentation.targetContext
    private val evidence get() = File(context.getExternalFilesDir(null), "artwork-qa").apply { mkdirs() }
    private val manifest get() = File(evidence, "fixture-base.txt")
    private val providerId = "artwork-qa"

    @Test fun seedFavoritesAndDurableArtwork() {
        val images = (1..30).associateWith { index ->
            val bitmap = Bitmap.createBitmap(180, 270, Bitmap.Config.ARGB_8888)
            Canvas(bitmap).apply {
                drawColor(android.graphics.Color.HSVToColor(floatArrayOf(index * 12f, .65f, .58f)))
                drawText("BLOFY", 14f, 60f, Paint().apply { color = -1; textSize = 28f; isAntiAlias = true })
                drawText(index.toString(), 35f, 190f, Paint().apply { color = -1; textSize = 80f; isAntiAlias = true })
            }
            ByteArrayOutputStream().also { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }.toByteArray()
        }
        val server = MockWebServer().apply {
            dispatcher = object : Dispatcher() {
                override fun dispatch(request: RecordedRequest): MockResponse {
                    val index = request.path?.substringAfterLast('/')?.toIntOrNull()
                    val bytes = images[index] ?: return MockResponse().setResponseCode(404)
                    return MockResponse().setHeader("Content-Type", "image/png").setBody(Buffer().write(bytes))
                }
            }; start()
        }
        val base = server.url("/").toString()
        manifest.writeText(base)
        try {
            withLibrary(base) { streams ->
                ActivityScenario.launch(LibraryActivity::class.java).use { scenario ->
                    awaitPoster(scenario, 0)
                    screenshot("favorites-first-open")
                    runBlocking(Dispatchers.IO) { streams.forEach { stream ->
                        assertTrue(ArtworkLoader.persist(context, checkNotNull(stream.backdrop)))
                    } }
                    verifyLastCardAndRemote(scenario)
                    screenshot("favorites-last-card")
                }
                assertTrue(streams.all { ArtworkLoader.isPersisted(context, checkNotNull(it.backdrop)) })
                File(evidence, "seed-result.txt").writeText("favorites=30\npersisted=30\nhttp_requests=${server.requestCount}\n")
            }
        } finally { server.shutdown() }
    }

    @Test fun reopenFavoritesOfflineAfterProcessRestart() {
        assertTrue("Run the seed method before stopping the app process", manifest.isFile)
        val base = manifest.readText()
        withLibrary(base) { streams ->
            assertTrue(streams.all { ArtworkLoader.isPersisted(context, checkNotNull(it.backdrop)) })
            // Disposable cache is absent and the previous process's HTTP server is gone.
            File(context.cacheDir, "blofy_posters").deleteRecursively()
            ArtworkLoader.clearMemory()
            ActivityScenario.launch(LibraryActivity::class.java).use { scenario ->
                awaitPoster(scenario, 0)
                screenshot("favorites-offline-first")
                verifyLastCardAndRemote(scenario)
                screenshot("favorites-offline-last")
            }
            File(evidence, "offline-result.txt").writeText("process_restarted=true\nsource_server_stopped=true\nfirst_and_last_posters=visible\nfavorites=30\n")
        }
    }

    private fun withLibrary(base: String, block: (List<StreamEntity>) -> Unit) {
        val singleton = BlofyDatabase::class.java.getDeclaredField("instance").apply { isAccessible = true }
        val previous = singleton.get(null)
        val db = Room.inMemoryDatabaseBuilder(context, BlofyDatabase::class.java).build()
        val streams = (1..30).map { i -> StreamEntity("$providerId:movie:$i", providerId, "$i", null,
            "movie", "فيلم ${i.toString().padStart(2, '0')}", icon = " ", backdrop = "${base}art/$i", favorite = true) }
        try {
            runBlocking(Dispatchers.IO) {
                db.dao().saveAndActivateProvider(ProviderEntity(providerId, "Artwork fixture", base, "fixture", "fixture"))
                db.dao().upsertStreams(streams)
            }
            singleton.set(null, db)
            block(streams)
        } finally { singleton.set(null, previous); db.close() }
    }

    private fun grid(activity: LibraryActivity) = descendants(activity.window.decorView)
        .filterIsInstance<RecyclerView>().first()

    private fun awaitPoster(scenario: ActivityScenario<LibraryActivity>, position: Int) {
        val end = SystemClock.elapsedRealtime() + 6_000
        var visible = false
        while (!visible && SystemClock.elapsedRealtime() < end) {
            scenario.onActivity { activity ->
                val list = grid(activity)
                assertTrue(list.adapter == null || list.adapter is PosterStreamAdapter)
                val holder = list.findViewHolderForAdapterPosition(position) as? PosterStreamAdapter.Holder
                val bitmap = (holder?.image?.drawable as? BitmapDrawable)?.bitmap
                visible = list.adapter?.itemCount == 30 && bitmap?.width == 180 && bitmap.height == 270
            }
            if (!visible) SystemClock.sleep(25)
        }
        assertTrue("Favorite $position must display its poster", visible)
    }

    private fun verifyLastCardAndRemote(scenario: ActivityScenario<LibraryActivity>) {
        // Phone emulators start in touch mode; keyboard focus requires leaving that mode.
        instrumentation.setInTouchMode(false)
        instrumentation.waitForIdleSync()
        scenario.onActivity { grid(it).scrollToPosition(29) }
        awaitPoster(scenario, 29)
        scenario.onActivity { assertTrue(grid(it).findViewHolderForAdapterPosition(29)!!.itemView.requestFocus()) }
        instrumentation.sendKeyDownUpSync(KeyEvent.KEYCODE_DPAD_UP)
        instrumentation.waitForIdleSync()
        scenario.onActivity { activity ->
            val list = grid(activity)
            val focus = activity.currentFocus
            assertNotNull(focus)
            val position = list.getChildAdapterPosition(focus!!)
            assertTrue("Remote must move through favorites", position in 0..28)
            assertTrue(focus.isShown)
        }
    }

    private fun screenshot(name: String) {
        instrumentation.waitForIdleSync()
        File(evidence, "$name.png").outputStream().use {
            assertTrue(instrumentation.uiAutomation.takeScreenshot().compress(Bitmap.CompressFormat.PNG, 100, it))
        }
    }

    private fun descendants(view: View): Sequence<View> = sequence {
        yield(view)
        if (view is ViewGroup) for (index in 0 until view.childCount) yieldAll(descendants(view.getChildAt(index)))
    }
}
