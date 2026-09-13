package tv.blofy.player.ui

import android.content.Intent
import android.graphics.Bitmap
import android.os.SystemClock
import android.view.View
import android.view.ViewGroup
import android.widget.GridLayout
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
import tv.blofy.player.data.local.*
import tv.blofy.player.data.metadata.ProviderMetadataCache
import tv.blofy.player.ui.details.MovieDetailsActivity
import tv.blofy.player.ui.details.SeriesDetailsActivity
import tv.blofy.player.ui.login.LoginActivity
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
            context.getSharedPreferences("blofy_player_settings", 0).edit().putString("app_language_tag", "ar").apply()
            if (android.os.Build.VERSION.SDK_INT >= 33) {
                context.getSystemService(android.app.LocaleManager::class.java).applicationLocales = android.os.LocaleList.forLanguageTags("ar")
            } else {
                androidx.appcompat.app.AppCompatDelegate.setApplicationLocales(androidx.core.os.LocaleListCompat.forLanguageTags("ar"))
            }
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
                    assertEquals("ar", androidx.core.os.ConfigurationCompat.getLocales(activity.resources.configuration)[0]?.language)
                    val root = activity.window.decorView
                    val title = root.findViewWithTag<TextView>("blofy_trial_title")
                    assertEquals(activity.getString(if (expired) R.string.trial_ended else R.string.trial_remaining), title.text.toString())
                    val qr = root.findViewWithTag<View>("blofy_login_qr_panel")
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
        runBlocking {
            db.dao().upsertProviderStored(ProviderEntity(id, "Fixture", server.url("/").toString(), "fixture", "fixture"))
            db.dao().upsertStreams(listOf("movie", "series").map { kind ->
                StreamEntity("$id:$kind:7", id, "7", "1", kind, "عنوان تجريبي")
            })
        }
        for (kind in listOf("movie", "series")) {
            server.enqueue(MockResponse().setBody("""{"info":{"plot":"وصف تجريبي من السيرفر","cast":[{"name":"ممثل تجريبي","character":"الدور الأول"},"ممثلة تجريبية"]}}"""))
            val type = if (kind == "movie") MovieDetailsActivity::class.java else SeriesDetailsActivity::class.java
            repeat(2) { opening ->
                ActivityScenario.launch<android.app.Activity>(Intent(context, type)
                    .putExtra("provider_id", id).putExtra("content_key", "$id:$kind:7")).use { scenario ->
                    await { scenario.onActivity { activity ->
                        val root = activity.window.decorView
                        assertEquals("وصف تجريبي من السيرفر", root.findViewWithTag<TextView>("blofy_details_overview")?.text?.toString())
                        val actor = root.findViewWithTag<View>("blofy_cast_ممثل تجريبي")
                        assertNotNull(actor)
                        actor.requestFocus()
                    } }
                    if (opening == 0) screenshot("details-$kind-cast")
                }
            }
        }
        assertEquals("Only one provider request per title", 2, server.requestCount)
    }

    @Test fun settingsCardsWrapTextAndKeepDirectionalFocus() {
        ActivityScenario.launch(SettingsActivity::class.java).use { scenario ->
            await { scenario.onActivity { activity ->
                val grids = descendants(activity.window.decorView).filterIsInstance<GridLayout>()
                assertTrue(grids.size >= 5)
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
                val card = grids.first().getChildAt(0)
                val before = card.contentDescription.toString()
                card.performClick()
                assertNotEquals(before, card.contentDescription.toString())
                card.requestFocus()
            } }
            screenshot("settings-cards")
            repeat(14) { instrumentation.sendKeyDownUpSync(android.view.KeyEvent.KEYCODE_DPAD_DOWN) }
            scenario.onActivity { activity ->
                val focused = activity.currentFocus!!
                val visible = android.graphics.Rect()
                assertTrue(focused.getGlobalVisibleRect(visible))
                assertTrue(visible.height() > 0)
            }
            screenshot("settings-cards-bottom")
        }
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
