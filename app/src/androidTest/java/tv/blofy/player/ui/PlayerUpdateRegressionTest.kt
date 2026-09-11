package tv.blofy.player.ui

import android.content.Intent
import android.graphics.Rect
import android.os.SystemClock
import android.view.KeyEvent
import android.view.View
import android.view.ViewGroup
import android.widget.ImageButton
import androidx.annotation.OptIn
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.ui.PlayerView
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import tv.blofy.player.R
import tv.blofy.player.core.device.DeviceClass
import tv.blofy.player.data.local.BlofyDatabase
import tv.blofy.player.data.local.ProviderEntity
import tv.blofy.player.data.local.StreamEntity
import tv.blofy.player.ui.player.PlayerActivity
import java.io.File

@OptIn(markerClass = [UnstableApi::class])
@RunWith(AndroidJUnit4::class)
class PlayerUpdateRegressionTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val context = instrumentation.targetContext

    @Test fun iconsAreAccessibleAndProgressIsSavedBeforeLeavingThePlayer() {
        val mediaUrl = requireNotNull(InstrumentationRegistry.getArguments().getString("mediaUrl"))
        val dao = BlofyDatabase.get(context).dao()
        val id = "rc36-checkpoint-qa"
        val key = "$id:movie"
        runBlocking {
            dao.upsertProvider(ProviderEntity(id, "BLOFY QA", "http://127.0.0.1:18764", "", "", providerType = "m3u"))
            dao.upsertStreams(listOf(StreamEntity(key, id, "1", null, "movie", "Big Buck Bunny • BLOFY", directSource = mediaUrl)))
        }
        val intent = Intent(context, PlayerActivity::class.java)
            .putExtra(PlayerActivity.EXTRA_URL, mediaUrl).putExtra(PlayerActivity.EXTRA_KIND, "movie")
            .putExtra(PlayerActivity.EXTRA_PROVIDER_ID, id).putExtra(PlayerActivity.EXTRA_CONTENT_KEY, key)
            .putExtra(PlayerActivity.EXTRA_TITLE, "Big Buck Bunny • BLOFY")
        try {
            ActivityScenario.launch<PlayerActivity>(intent).use { scenario ->
                awaitUi {
                    scenario.onActivity { activity ->
                        val player = descendants(activity.window.decorView).filterIsInstance<PlayerView>().single().player!!
                        assertEquals(Player.STATE_READY, player.playbackState)
                        assertTrue(player.duration > 120_000L)
                    }
                }
                scenario.onActivity { activity ->
                    descendants(activity.window.decorView).filterIsInstance<PlayerView>().single().player!!.seekTo(90_000L)
                }
                // This assertion happens while the Activity remains resumed: leaving is not the trigger.
                awaitUi {
                    val saved = runBlocking { dao.watchState(key) }
                    assertNotNull(saved)
                    assertTrue(saved!!.positionMs >= 90_000L)
                    assertFalse(saved.completed)
                }
                if (DeviceClass.isTv(context)) instrumentation.sendKeyDownUpSync(KeyEvent.KEYCODE_DPAD_CENTER)
                else scenario.onActivity { activity ->
                    descendants(activity.window.decorView).first { it.contentDescription == activity.getString(R.string.player_toggle_controls) }.performClick()
                }
                awaitUi { scenario.onActivity { activity ->
                    val buttons = descendants(activity.window.decorView).filterIsInstance<ImageButton>().filter { it.isShown }
                    assertEquals(7, buttons.size)
                    for (button in buttons) {
                        assertFalse(button.contentDescription.isNullOrBlank())
                        assertNotNull(button.drawable)
                        val rect = Rect(); assertTrue(button.getGlobalVisibleRect(rect))
                        assertEquals(button.height, rect.height())
                        assertTrue(button.height >= (48 * context.resources.displayMetrics.density).toInt())
                    }
                    buttons.first { it.contentDescription == activity.getString(R.string.player_subtitles) }.requestFocus()
                } }
                screenshot("rc36-player-icons")
                scenario.recreate()
                awaitUi { scenario.onActivity { activity ->
                    val player = descendants(activity.window.decorView).filterIsInstance<PlayerView>().single().player!!
                    assertEquals(Player.STATE_READY, player.playbackState)
                    assertTrue("Position lost on recreation", player.currentPosition >= 90_000L)
                } }
            }
        } finally {
            runBlocking { dao.clearProviderCatalog(id); dao.deleteProvider(id) }
        }
    }

    private fun descendants(view: View): List<View> = listOf(view) + if (view is ViewGroup)
        (0 until view.childCount).flatMap { descendants(view.getChildAt(it)) } else emptyList()

    private fun awaitUi(check: () -> Unit) {
        var last: AssertionError? = null
        repeat(100) {
            instrumentation.waitForIdleSync()
            try { check(); return } catch (error: AssertionError) { last = error }
            SystemClock.sleep(200)
        }
        throw last ?: AssertionError("Timed out")
    }

    private fun screenshot(name: String) {
        val file = File(context.getExternalFilesDir(null), "mobile-qa/$name.png")
        file.parentFile!!.mkdirs()
        file.outputStream().use { instrumentation.uiAutomation.takeScreenshot().compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it) }
    }
}
