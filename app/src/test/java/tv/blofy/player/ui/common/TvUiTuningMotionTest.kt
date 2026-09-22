package tv.blofy.player.ui.common

import android.app.Application
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28], application = Application::class)
class TvUiTuningMotionTest {
    private val context get() = RuntimeEnvironment.getApplication()

    @Test fun reducedMotionKeepsFocusVisibleWithoutZoomOrLift() {
        val prefs = context.getSharedPreferences("blofy_player_settings", 0)
        prefs.edit().putString("motion_mode", "reduced").commit()

        assertTrue(TvUiTuning.reducedMotion(context))
        assertEquals(1f, TvUiTuning.focusScale(context, 1.028f), 0f)
        assertEquals(0f, TvUiTuning.focusElevation(context, 12f), 0f)
        assertEquals(35L, TvUiTuning.focusDuration(context, true))
        assertEquals(35L, TvUiTuning.focusDuration(context, false))
    }

    @Test fun smoothMotionUsesRequestedFocusGeometryAndSharedTiming() {
        val prefs = context.getSharedPreferences("blofy_player_settings", 0)
        prefs.edit().putString("motion_mode", "smooth").commit()

        assertFalse(TvUiTuning.reducedMotion(context))
        assertEquals(1.024f, TvUiTuning.focusScale(context, 1.024f), 0f)
        assertEquals(12f, TvUiTuning.focusElevation(context, 12f), 0f)
        assertEquals(BlofyTvDesign.FocusInMs, TvUiTuning.focusDuration(context, true))
        assertEquals(BlofyTvDesign.FocusOutMs, TvUiTuning.focusDuration(context, false))
    }
}
