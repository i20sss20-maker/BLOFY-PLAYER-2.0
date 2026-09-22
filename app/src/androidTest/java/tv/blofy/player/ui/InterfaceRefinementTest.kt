package tv.blofy.player.ui

import android.content.Intent
import android.graphics.Bitmap
import android.os.SystemClock
import android.view.View
import android.view.ViewGroup
import android.widget.GridLayout
import android.widget.LinearLayout
import android.widget.TextView
import androidx.room.Room
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.runBlocking
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.*
import org.junit.Assert.*
import org.junit.runner.RunWith
import tv.blofy.player.R
import tv.blofy.player.core.device.DeviceClass
import tv.blofy.player.core.identity.ActivationCheckResponse
import tv.blofy.player.core.identity.ActivationDisplayState
import tv.blofy.player.core.identity.ActivationManager
import tv.blofy.player.core.profile.ProfileStore
import tv.blofy.player.core.security.ParentalGate
import tv.blofy.player.data.local.*
import tv.blofy.player.data.metadata.ProviderMetadataCache
import tv.blofy.player.ui.details.MovieDetailsActivity
import tv.blofy.player.ui.details.SeriesDetailsActivity
import tv.blofy.player.ui.login.LoginActivity
import tv.blofy.player.ui.settings.RuntimeSettings
import tv.blofy.player.ui.settings.SettingsActivity
import java.io.File

@RunWith(AndroidJUnit4::class)
class InterfaceRefinementTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val context = instrumentation.targetContext
    private val singleton = BlofyDatabase::class.java.getDeclaredField("instance").apply { isAccessible = true }
    private var previous: Any? = null
    private lateinit var db: BlofyDatabase
    private lateinit var server: MockWebServer
    private val id = "refinement-${System.nanoTime()}"

    @Before fun setup() {
        instrumentation.runOnMainSync {
            ParentalGate.clearPin(context)
            ProfileStore.select(context, "main")
        }
        previous = singleton.get(null)
        db = Room.inMemoryDatabaseBuilder(context, BlofyDatabase::class.java).build()
        singleton.set(null, db)
        server = MockWebServer().apply { start() }
        val expected = InstrumentationRegistry.getArguments().getString("expected_kind")
        if (expected != null) assertEquals(expected == "tv", DeviceClass.isTv(context))
    }

    @After fun cleanup() {
        singleton.set(null, previous)
        db.close()
        server.shutdown()
        ProviderMetadataCache.clearProvider(context, id)
    }

    @Test fun trialAndExpiredStatusAreVisibleBelowTheQr() {
        for (expired in listOf(false, true)) {
            runBlocking {
                val identity = ActivationManager(context, db.dao()).ensureIdentity().copy(
                    activated = !expired,
                    expiresAt = System.currentTimeMillis() + if (expired) -60_000L else 183_600_000L)
                db.dao().upsertActivation(identity)
                ActivationDisplayState.record(context, identity, ActivationCheckResponse("trial", identity.expiresAt))
            }
            ActivityScenario.launch(LoginActivity::class.java).use { scenario ->
                await { scenario.onActivity { activity ->
                    val root = activity.window.decorView
                    val title = root.findViewWithTag<TextView>("blofy_trial_title")
                    assertEquals(activity.getString(if (expired) R.string.trial_ended else R.string.trial_remaining), title.text.toString())
                    val qr = root.findViewWithTag<View>("blofy_login_qr_panel")
                    assertTrue("QR panel must keep its premium frame", qr.background is android.graphics.drawable.GradientDrawable)
                    val status = root.findViewWithTag<View>("blofy_trial_status")
                    val qrPosition = IntArray(2).also(qr::getLocationOnScreen)
                    val statusPosition = IntArray(2).also(status::getLocationOnScreen)
                    assertTrue(statusPosition[1] >= qrPosition[1] + qr.height)
                    status.requestRectangleOnScreen(android.graphics.Rect(0, 0, status.width, status.height), true)
                } }
                screenshot(if (expired) "trial-expired" else "trial-active")
            }
        }
    }

    @Test fun selectedMovieAndSeriesFetchStoryAndCastThenReopenWithoutAnotherRequest() {
        val previousProfile = ProfileStore.active(context).id
        val guest = ProfileStore.all(context).firstOrNull { it.guest }
            ?: ProfileStore.create(context, "UI Fixture", guest = true)
        assertTrue(ProfileStore.select(context, guest.id))
        try {
            runBlocking {
                db.dao().upsertProviderStored(ProviderEntity(id, "Fixture", server.url("/").toString(), "fixture", "fixture"))
                db.dao().upsertStreams(listOf("movie", "series").map { kind ->
                    StreamEntity("$id:$kind:7", id, "7", "1", kind, "عنوان تجريبي")
                })
            }
        val detailRequests = java.util.concurrent.atomic.AtomicInteger()
        val imageBytes = java.io.ByteArrayOutputStream().also { output ->
            Bitmap.createBitmap(48, 72, Bitmap.Config.ARGB_8888).apply { eraseColor(0xFF7853A8.toInt()) }
                .compress(Bitmap.CompressFormat.PNG, 100, output)
        }.toByteArray()
        server.dispatcher = object : okhttp3.mockwebserver.Dispatcher() {
            override fun dispatch(request: okhttp3.mockwebserver.RecordedRequest): MockResponse {
                if (request.path?.startsWith("/art/") == true) return MockResponse()
                    .setHeader("Content-Type", "image/png").setBody(okio.Buffer().write(imageBytes))
                detailRequests.incrementAndGet()
                return MockResponse().setBody("""{"info":{"plot":"وصف تجريبي من السيرفر","rating_5based":4.2,"cover":"${server.url("/art/poster.png")}","cast":"ممثل تجريبي،ممثلة تجريبية","actors":[{"name":"ممثل تجريبي","character":"الدور الأول","photo":"${server.url("/art/actor.png")}"}]}}""")
            }
        }
        for (kind in listOf("movie", "series")) {
            val type = if (kind == "movie") MovieDetailsActivity::class.java else SeriesDetailsActivity::class.java
            repeat(2) { opening ->
                withStableDetailsScenario(Intent(context, type)
                    .putExtra("provider_id", id).putExtra("content_key", "$id:$kind:7")) { scenario ->
                    await { scenario.onActivity { activity ->
                        val root = activity.window.decorView
                        val overview = root.findViewWithTag<TextView>("blofy_details_overview")
                        val stats = root.findViewWithTag<TextView>("blofy_details_stats")
                        assertEquals("وصف تجريبي من السيرفر", overview?.text?.toString())
                        assertTrue(stats.text.contains("8.4/10"))
                        assertNotNull("Details overview must keep its readable surface", overview.background)
                        assertNotNull("Details metadata must keep its badge surface", stats.background)
                        val watchlist = root.findViewWithTag<View>("blofy_profile_watchlist_action")
                        assertNotNull("Watchlist action must stay inside the details action strip", watchlist)
                        assertTrue("Watchlist action must be hosted by an inline action row", watchlist.parent is LinearLayout)
                        assertFalse("Watchlist action must never float directly over the details root", watchlist.parent === root)
                        val actor = root.findViewWithTag<View>("blofy_cast_ممثل تجريبي")
                        assertNotNull(actor)
                        assertTrue(descendants(actor).filterIsInstance<android.widget.ImageView>()
                            .any { image -> (image.drawable as? android.graphics.drawable.BitmapDrawable)?.bitmap?.let { it.width == 48 && it.height == 72 } == true })
                        actor.requestFocus()
                    } }
                    if (opening == 0) screenshot("details-$kind-cast")
                }
            }
        }
            assertEquals("Only one provider detail request per title", 2, detailRequests.get())
        } finally {
            ProfileStore.select(context, previousProfile)
        }
    }

    @Test fun settingsCardsWrapTextAndKeepDirectionalFocus() {
        ActivityScenario.launch(SettingsActivity::class.java).use { scenario ->
            await { scenario.onActivity { activity ->
                val grids = descendants(activity.window.decorView).filterIsInstance<GridLayout>()
                assertTrue(grids.size >= 5)
                val subtitle = descendants(activity.window.decorView).filterIsInstance<TextView>()
                    .first { it.text.toString() == activity.getString(R.string.settings_subtitle) }
                assertTrue("Settings subtitle must not be clipped", subtitle.height >= (subtitle.layout?.height ?: 0))
                grids.forEach { grid ->
                    for (i in 0 until grid.childCount) {
                        val card = grid.getChildAt(i) as ViewGroup
                        assertTrue(card.isFocusable)
                        assertTrue(card.height > 0)
                        for (label in descendants(card).filterIsInstance<TextView>().filter { it.visibility == View.VISIBLE }) {
                            assertTrue("Settings text clipped: ${label.text}", label.height >= (label.layout?.height ?: 0) + label.paddingTop + label.paddingBottom)
                        }
                    }
                }
                val card = activity.window.decorView.findViewWithTag<View>("setting_${RuntimeSettings.KEY_MOTION}")
                assertNotNull("Motion setting card must stay addressable", card)
                val before = card.contentDescription.toString()
                card.performClick()
                assertNotEquals(before, card.contentDescription.toString())
                card.requestFocus()
            } }
            screenshot("settings-cards")
            instrumentation.uiAutomation.executeShellCommand("dumpsys gfxinfo ${context.packageName} reset").close()
            repeat(14) { instrumentation.sendKeyDownUpSync(android.view.KeyEvent.KEYCODE_DPAD_DOWN) }
            scenario.onActivity { activity ->
                val focused = activity.currentFocus!!
                val visible = android.graphics.Rect()
                assertTrue(focused.getGlobalVisibleRect(visible))
                assertTrue(visible.height() > 0)
            }
            screenshot("settings-cards-bottom")
            for ((name, command) in listOf("settings-gfxinfo" to "dumpsys gfxinfo ${context.packageName}",
                "settings-memory" to "dumpsys meminfo ${context.packageName}")) {
                val output = android.os.ParcelFileDescriptor.AutoCloseInputStream(
                    instrumentation.uiAutomation.executeShellCommand(command)).bufferedReader().use { it.readText() }
                File(context.getExternalFilesDir("ui-refinement"), "$name.txt").writeText(output)
                android.util.Log.i("BLOFY_UI_PERFORMANCE", "$name: $output")
            }
        }
    }

    private fun withStableDetailsScenario(
        intent: Intent,
        block: (ActivityScenario<android.app.Activity>) -> Unit
    ) {
        var firstDestroyed: NullPointerException? = null
        repeat(2) { attempt ->
            try {
                ActivityScenario.launch<android.app.Activity>(intent).use(block)
                return
            } catch (error: NullPointerException) {
                val transient = error.message.orEmpty().contains("Activity has been destroyed already")
                if (!transient || attempt > 0) throw error
                firstDestroyed = error
                android.util.Log.w("BLOFY_UI_TEST", "Initial TV details activity was recreated; retrying once", error)
                instrumentation.waitForIdleSync()
                SystemClock.sleep(250)
            }
        }
        throw firstDestroyed ?: AssertionError("Details scenario did not run")
    }

    private fun descendants(root: View): List<View> = listOf(root) + if (root is ViewGroup)
        (0 until root.childCount).flatMap { descendants(root.getChildAt(it)) } else emptyList()
    private fun await(check: () -> Unit) {
        val deadline = SystemClock.elapsedRealtime() + 10_000L
        var last: Throwable? = null
        while (SystemClock.elapsedRealtime() < deadline) {
            try { instrumentation.waitForIdleSync(); check(); return } catch (error: AssertionError) { last = error }
            SystemClock.sleep(60)
        }
        throw AssertionError("UI did not reach the expected state", last)
    }
    private fun screenshot(name: String) {
        instrumentation.waitForIdleSync()
        // Wait for the render thread to present the state already asserted on the UI thread.
        SystemClock.sleep(300)
        val bitmap = instrumentation.uiAutomation.takeScreenshot()
        val file = File(context.getExternalFilesDir("ui-refinement"), "$name.png")
        file.outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
        bitmap.recycle()
    }
}
