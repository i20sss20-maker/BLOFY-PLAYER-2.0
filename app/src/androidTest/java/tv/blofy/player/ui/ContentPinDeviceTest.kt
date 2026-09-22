package tv.blofy.player.ui

import android.content.Intent
import android.graphics.Bitmap
import android.os.Bundle
import android.os.SystemClock
import android.view.KeyEvent
import android.view.accessibility.AccessibilityNodeInfo
import androidx.appcompat.app.AppCompatActivity
import androidx.room.Room
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import tv.blofy.player.core.profile.ProfileStore
import tv.blofy.player.core.security.ParentalGate
import tv.blofy.player.core.security.ContentAccessActivity
import tv.blofy.player.data.local.*
import tv.blofy.player.ui.catchup.CatchupActivity
import tv.blofy.player.ui.details.MovieDetailsActivity
import tv.blofy.player.ui.details.SeriesDetailsActivity
import tv.blofy.player.ui.player.PlayerActivity
import tv.blofy.player.ui.series.EpisodesActivity
import java.io.File

@RunWith(AndroidJUnit4::class)
class ContentPinDeviceTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val context = instrumentation.targetContext
    private val automation get() = instrumentation.uiAutomation
    private fun nodes(node: AccessibilityNodeInfo?): List<AccessibilityNodeInfo> = if (node == null) emptyList() else
        listOf(node) + (0 until node.childCount).flatMap { nodes(node.getChild(it)) }
    private fun appNodes(): List<AccessibilityNodeInfo> {
        // On phones EditText.error opens a separate accessibility window over the PIN dialog.
        // Query all visible app windows, so the error popup/IME cannot hide the protected dialog.
        val windows = automation.windows
        val roots = if (windows.isEmpty()) listOf(automation.rootInActiveWindow) else windows.map { it.root }
        return roots.flatMap(::nodes).filter { it.packageName?.toString() == context.packageName && it.isVisibleToUser }
    }
    private fun await(condition: () -> Boolean) {
        val deadline = SystemClock.elapsedRealtime() + 8_000L
        while (!condition() && SystemClock.elapsedRealtime() < deadline) SystemClock.sleep(25)
        assertTrue("Timed out waiting for PIN UI", condition())
    }
    private fun pinVisible() = appNodes().any { it.className == "android.widget.EditText" }
    private fun answer(pin: String) {
        await(::pinVisible)
        val input = appNodes().single { it.className == "android.widget.EditText" }
        assertTrue(input.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, Bundle().apply {
            putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, pin)
        }))
        click("android:id/button1")
        instrumentation.waitForIdleSync()
    }
    private fun click(id: String) {
        // ACTION_SET_TEXT can briefly replace the accessibility window while the IME opens.
        // Reacquire the actual button after that transition; never reuse a stale node.
        var clicked = false
        val deadline = SystemClock.elapsedRealtime() + 8_000L
        while (!clicked && SystemClock.elapsedRealtime() < deadline) {
            clicked = appNodes().firstOrNull { it.viewIdResourceName == id }
                ?.performAction(AccessibilityNodeInfo.ACTION_CLICK) == true
            if (!clicked) SystemClock.sleep(25)
        }
        if (!clicked) {
            val evidence = File(context.getExternalFilesDir(null), "artwork-qa").apply { mkdirs() }
            automation.takeScreenshot().let { bitmap ->
                File(evidence, "content-pin-missing-button.png").outputStream().use {
                    bitmap.compress(Bitmap.CompressFormat.PNG, 100, it)
                }
                bitmap.recycle()
            }
            File(evidence, "content-pin-missing-button.txt").writeText(appNodes().joinToString("\n") {
                "${it.className} id=${it.viewIdResourceName} clickable=${it.isClickable}"
            })
        }
        assertTrue("PIN dialog button was not actionable: $id", clicked)
    }

    @Test fun contentPinGuardsDetailsEpisodesAndPlayer() {
        automation.serviceInfo = automation.serviceInfo.apply {
            flags = flags or android.accessibilityservice.AccessibilityServiceInfo.FLAG_REPORT_VIEW_IDS or
                android.accessibilityservice.AccessibilityServiceInfo.FLAG_RETRIEVE_INTERACTIVE_WINDOWS
        }
        val singleton = BlofyDatabase::class.java.getDeclaredField("instance").apply { isAccessible = true }
        val previous = singleton.get(null)
        val db = Room.inMemoryDatabaseBuilder(context, BlofyDatabase::class.java).build()
        val movie = StreamEntity("pin:movie:1", "pin", "1", null, "movie", "Safe test movie", locked = true)
        val series = StreamEntity("pin:series:42.000", "pin", "42.000", null, "series", "Safe test series", locked = true)
        val live = StreamEntity("pin:live:3", "pin", "3", null, "live", "Safe test live", locked = true)
        val episode = EpisodeEntity("pin:episode:7", "pin", "42", "7", 1, 1, "Episode one")
        val evidence = File(context.getExternalFilesDir(null), "artwork-qa").apply { mkdirs() }
        try {
            runBlocking(Dispatchers.IO) {
                db.dao().saveAndActivateProvider(ProviderEntity("pin", "PIN fixture", "https://example.test", "fixture", "fixture", providerType = "m3u"))
                db.dao().upsertStreams(listOf(movie, series, live))
                db.dao().upsertEpisodes(listOf(episode))
            }
            singleton.set(null, db)
            ProfileStore.select(context, "main")
            val targets = listOf(
                MovieDetailsActivity::class.java to movie.key,
                SeriesDetailsActivity::class.java to series.key,
                EpisodesActivity::class.java to "",
                CatchupActivity::class.java to live.key,
                PlayerActivity::class.java to episode.key
            )
            targets.forEach { (type, key) ->
                assertTrue(ParentalGate.setPin(context, "1234"))
                val source = Intent(context, type).putExtra("provider_id", "pin").putExtra("content_key", key)
                    .putExtra("series_id", "42").putExtra("kind", "episode").putExtra("url", "https://example.test/7.mp4")
                ActivityScenario.launch<AppCompatActivity>(source).use { scenario ->
                    await(::pinVisible)
                    answer("9999")
                    await(::pinVisible)
                    scenario.onActivity { activity ->
                        assertFalse("${type.simpleName} must not load after a wrong PIN",
                            ContentAccessActivity::class.java.getDeclaredField("contentReady")
                                .apply { isAccessible = true }.getBoolean(activity))
                        if (activity is PlayerActivity) assertNull(PlayerActivity::class.java.getDeclaredField("session")
                            .apply { isAccessible = true }.get(activity))
                    }
                    if (type == PlayerActivity::class.java) {
                        automation.takeScreenshot().let { bitmap ->
                            File(evidence, "content-pin-before-playback.png").outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
                            bitmap.recycle()
                        }
                    }
                    // Exercise actual phone/remote BACK cancellation. A phone may first dismiss
                    // the IME/error popup; it must then close the PIN and protected destination.
                    repeat(3) {
                        if (scenario.state != androidx.lifecycle.Lifecycle.State.DESTROYED) {
                            instrumentation.sendKeyDownUpSync(KeyEvent.KEYCODE_BACK)
                            val deadline = SystemClock.elapsedRealtime() + 1_000L
                            while (scenario.state != androidx.lifecycle.Lifecycle.State.DESTROYED &&
                                SystemClock.elapsedRealtime() < deadline) SystemClock.sleep(25)
                        }
                    }
                    await { scenario.state == androidx.lifecycle.Lifecycle.State.DESTROYED }
                }
            }
            ParentalGate.setPin(context, "1234")
            ActivityScenario.launch<MovieDetailsActivity>(Intent(context, MovieDetailsActivity::class.java)
                .putExtra("provider_id", "pin").putExtra("content_key", movie.key)).use {
                await(::pinVisible)
                answer("1234")
                await { appNodes().any { node -> node.text?.toString() == movie.name } }
                assertFalse(pinVisible())
            }
            File(evidence, "content-pin-result.txt").writeText(
                "destinations=movie,series,episodes,catchup,player\nwrong_pin=blocked\ncancel=closed\nplayer_created_before_pin=false\nlegacy_episode_parent=protected\ncorrect_pin=opened_movie\n")
        } finally {
            ParentalGate.clearPin(context)
            singleton.set(null, previous)
            db.close()
        }
    }
}
