package tv.blofy.player.ui

import android.content.Intent
import android.content.pm.ActivityInfo
import android.graphics.Rect
import android.os.SystemClock
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.TextView
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import tv.blofy.player.R
import tv.blofy.player.data.local.*
import tv.blofy.player.ui.details.MovieDetailsActivity
import tv.blofy.player.ui.details.SeriesDetailsActivity
import tv.blofy.player.ui.player.PlayerActivity
import java.io.File

@RunWith(AndroidJUnit4::class)
class MobileUiRegressionTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val context = instrumentation.targetContext

    @Test fun movieAndSeriesPrimaryActionsStayVisibleWithoutRotating() {
        val dao = BlofyDatabase.get(context).dao()
        val id = "mobile-ui-test-${System.nanoTime()}"
        runBlocking {
            dao.upsertProvider(ProviderEntity(id, "UI test", "https://example.test", "", "", providerType = "m3u"))
            dao.upsertStreams(listOf("movie", "series").map { kind ->
                StreamEntity("$id:$kind", id, "1", null, kind, "BLOFY • اختبار العرض على الجوال",
                    directSource = "https://example.test/sample.mp4", plot = "تفاصيل طويلة للتحقق من بقاء زر المشاهدة ظاهرًا. ".repeat(40))
            })
        }
        try {
            for (kind in listOf("movie", "series")) {
                val type = if (kind == "movie") MovieDetailsActivity::class.java else SeriesDetailsActivity::class.java
                val intent = Intent(context, type).putExtra("provider_id", id).putExtra("content_key", "$id:$kind")
                ActivityScenario.launch<android.app.Activity>(intent).use { scenario ->
                    for ((label, rotation) in listOf("portrait" to ActivityInfo.SCREEN_ORIENTATION_PORTRAIT, "landscape" to ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE)) {
                        scenario.onActivity { it.requestedOrientation = rotation }
                        awaitUi { scenario.onActivity { activity ->
                            val text = activity.getString(if (kind == "movie") R.string.details_watch_now else R.string.details_seasons_episodes)
                            val button = descendants(activity.window.decorView).filterIsInstance<Button>().firstOrNull { it.text.toString() == text }
                            assertNotNull("$kind action missing in $label", button)
                            assertFullyVisible(button!!)
                        } }
                        screenshot("$kind-$label")
                    }
                }
            }
        } finally {
            runBlocking { dao.clearProviderCatalog(id); dao.deleteProvider(id) }
        }
    }

    @Test fun touchControlsAndFullscreenSurviveRotationAndDialog() {
        val mediaUrl = InstrumentationRegistry.getArguments().getString("mediaUrl") ?: "https://example.test/sample.mp4"
        val intent = Intent(context, PlayerActivity::class.java)
            .putExtra(PlayerActivity.EXTRA_URL, mediaUrl)
            .putExtra(PlayerActivity.EXTRA_KIND, "movie")
            .putExtra(PlayerActivity.EXTRA_TITLE, "BLOFY • اختبار المشغّل")
        ActivityScenario.launch<PlayerActivity>(intent).use { scenario ->
            for ((label, rotation) in listOf("portrait" to ActivityInfo.SCREEN_ORIENTATION_PORTRAIT, "landscape" to ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE)) {
                scenario.onActivity { it.requestedOrientation = rotation }
                SystemClock.sleep(3800)
                // A fresh emulator shows Android's own first-use immersive education above the app.
                val systemRoot = instrumentation.uiAutomation.rootInActiveWindow
                if (systemRoot?.findAccessibilityNodeInfosByText("Viewing full screen")?.isNotEmpty() == true) {
                    systemRoot.findAccessibilityNodeInfosByText("Got it").firstOrNull()
                        ?.performAction(android.view.accessibility.AccessibilityNodeInfo.ACTION_CLICK)
                    instrumentation.waitForIdleSync()
                }
                var point = Pair(0f, 0f)
                scenario.onActivity { activity ->
                    val surface = descendants(activity.window.decorView).first { it.contentDescription == activity.getString(R.string.player_toggle_controls) }
                    val bounds = Rect(); assertTrue(surface.getGlobalVisibleRect(bounds))
                    point = bounds.centerX().toFloat() to (bounds.top + bounds.height() / 4).toFloat()
                }
                tap(point.first, point.second)
                screenshot("player-$label-after-touch")
                awaitUi { scenario.onActivity { activity ->
                    val buttons = descendants(activity.window.decorView).filterIsInstance<Button>().filter { it.isShown }
                    val pause = buttons.firstOrNull { it.text == activity.getString(R.string.player_pause) || it.text == activity.getString(R.string.player_play) }
                    assertNotNull("Touch did not reveal controls in $label", pause)
                    assertFullyVisible(pause!!)
                    val bars = ViewCompat.getRootWindowInsets(activity.window.decorView)!!
                    assertFalse("Status bar covers video", bars.isVisible(WindowInsetsCompat.Type.statusBars()))
                    assertFalse("Navigation bar covers video", bars.isVisible(WindowInsetsCompat.Type.navigationBars()))
                } }
                screenshot("player-$label-controls")
                scenario.onActivity { activity ->
                    descendants(activity.window.decorView).filterIsInstance<Button>().first { it.text == activity.getString(R.string.player_quality) }.performClick()
                }
                instrumentation.waitForIdleSync()
                instrumentation.sendKeyDownUpSync(android.view.KeyEvent.KEYCODE_BACK)
                awaitUi { scenario.onActivity { activity ->
                    assertFalse(ViewCompat.getRootWindowInsets(activity.window.decorView)!!.isVisible(WindowInsetsCompat.Type.statusBars()))
                } }
            }
        }
    }

    private fun assertFullyVisible(view: View) {
        val rect = Rect()
        assertTrue(view.getGlobalVisibleRect(rect))
        assertEquals("Action clipped horizontally", view.width, rect.width())
        assertEquals("Action clipped vertically", view.height, rect.height())
        assertTrue("Touch target too small", view.height >= (48 * view.resources.displayMetrics.density).toInt())
    }

    private fun descendants(view: View): List<View> = listOf(view) + if (view is ViewGroup) (0 until view.childCount).flatMap { descendants(view.getChildAt(it)) } else emptyList()
    private fun awaitUi(check: () -> Unit) {
        var error: Throwable? = null
        repeat(30) {
            instrumentation.waitForIdleSync()
            try { check(); return } catch (failure: AssertionError) { error = failure }
            SystemClock.sleep(150)
        }
        throw error ?: AssertionError("UI timeout")
    }
    private fun tap(x: Float, y: Float) {
        val time = SystemClock.uptimeMillis()
        for (action in listOf(MotionEvent.ACTION_DOWN, MotionEvent.ACTION_UP)) {
            val event = MotionEvent.obtain(time, SystemClock.uptimeMillis(), action, x, y, 0)
            event.source = android.view.InputDevice.SOURCE_TOUCHSCREEN
            instrumentation.uiAutomation.injectInputEvent(event, true)
            event.recycle()
        }
    }
    private fun screenshot(name: String) {
        val file = File(context.getExternalFilesDir(null), "mobile-qa/$name.png")
        file.parentFile!!.mkdirs()
        file.outputStream().use { instrumentation.uiAutomation.takeScreenshot().compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it) }
    }
}
