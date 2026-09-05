package tv.blofy.player.ui.settings

import android.app.Application
import android.content.Context
import androidx.media3.ui.AspectRatioFrameLayout
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28], application = Application::class)
class RuntimeSettingsTest {
    private val app get() = RuntimeEnvironment.getApplication()
    private val prefs get() = app.getSharedPreferences(RuntimeSettings.PREFS, Context.MODE_PRIVATE)

    @Before fun setup() { prefs.edit().clear().commit() }
    @After fun cleanup() { prefs.edit().clear().commit() }

    @Test fun defaultsMatchSettingsScreen() {
        assertTrue(RuntimeSettings.autoplayLive(app))
        assertTrue(RuntimeSettings.askBeforeResume(app))
        assertEquals(RuntimeSettings.AutoNext.ASK, RuntimeSettings.autoNext(app))
        assertEquals(RuntimeSettings.SubtitleLanguage.ARABIC_FIRST, RuntimeSettings.subtitleLanguage(app))
        assertEquals(AspectRatioFrameLayout.RESIZE_MODE_FIT, RuntimeSettings.aspectResizeMode(app))
        assertEquals(18f, RuntimeSettings.subtitleSizeSp(app), 0f)
        assertFalse(RuntimeSettings.preferStereoTrack(app))
    }

    @Test fun storedChoicesDriveRuntimePolicy() {
        prefs.edit()
            .putString(RuntimeSettings.KEY_AUTOPLAY_LIVE, "off")
            .putString(RuntimeSettings.KEY_RESUME_PROMPT, "off")
            .putString(RuntimeSettings.KEY_AUTO_NEXT, "on")
            .putString(RuntimeSettings.KEY_SUBTITLE_LANGUAGE, "off")
            .putString(RuntimeSettings.KEY_SUBTITLE_SIZE, "large")
            .putString(RuntimeSettings.KEY_ASPECT, "zoom")
            .putString(RuntimeSettings.KEY_AUDIO_OUTPUT, "stereo")
            .commit()
        assertFalse(RuntimeSettings.autoplayLive(app))
        assertFalse(RuntimeSettings.askBeforeResume(app))
        assertEquals(RuntimeSettings.AutoNext.ON, RuntimeSettings.autoNext(app))
        assertEquals(RuntimeSettings.SubtitleLanguage.OFF, RuntimeSettings.subtitleLanguage(app))
        assertEquals(26f, RuntimeSettings.subtitleSizeSp(app), 0f)
        assertEquals(AspectRatioFrameLayout.RESIZE_MODE_ZOOM, RuntimeSettings.aspectResizeMode(app))
        assertTrue(RuntimeSettings.preferStereoTrack(app))
    }

    @Test fun invalidValuesFallBackSafely() {
        prefs.edit().putString(RuntimeSettings.KEY_AUTO_NEXT, "broken")
            .putString(RuntimeSettings.KEY_ASPECT, "broken")
            .putString(RuntimeSettings.KEY_SUBTITLE_SIZE, "broken")
            .commit()
        assertEquals(RuntimeSettings.AutoNext.ASK, RuntimeSettings.autoNext(app))
        assertEquals(AspectRatioFrameLayout.RESIZE_MODE_FIT, RuntimeSettings.aspectResizeMode(app))
        assertEquals(18f, RuntimeSettings.subtitleSizeSp(app), 0f)
    }
}
