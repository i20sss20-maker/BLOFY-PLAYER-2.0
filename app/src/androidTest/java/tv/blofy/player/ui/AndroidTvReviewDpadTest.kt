package tv.blofy.player.ui

import android.graphics.BitmapFactory
import android.view.KeyEvent
import android.widget.Button
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import tv.blofy.player.R
import tv.blofy.player.core.device.DeviceClass
import tv.blofy.player.ui.login.LoginActivity

/** Physical DPAD/navigation review, intended for Android TV emulator/device; not a phone test. */
@RunWith(AndroidJUnit4::class)
class AndroidTvReviewDpadTest {
    private val instrumentation get() = InstrumentationRegistry.getInstrumentation()
    private val context get() = instrumentation.targetContext

    @Before fun onlyRunOnTvReviewDevice() {
        assumeTrue(InstrumentationRegistry.getArguments().getString("tvReview") == "true")
        assumeTrue(DeviceClass.isTv(context))
    }

    @Test fun launcherResourcesMatchTvPolicy() {
        val options = BitmapFactory.Options().apply { inScaled = false }
        val banner = BitmapFactory.decodeResource(context.resources, R.drawable.blofy_tv_banner, options)
        assertNotNull("TV launcher banner must be packaged into the app, not just Play listing", banner)
        assertEquals("TV xhdpi banner width", 320, banner.width)
        assertEquals("TV xhdpi banner height", 180, banner.height)
        banner.recycle()

        val icon = BitmapFactory.decodeResource(context.resources, R.mipmap.blofy_tv_icon, options)
        assertNotNull("TV icon must be bundled with the app", icon)
        assertEquals("TV icon width", 512, icon.width)
        assertEquals("TV icon height", 512, icon.height)
        icon.recycle()
    }

    @Test fun loginFocusCanReachHeaderByRemoteAndReturnToPlaylistActions() {
        ActivityScenario.launch(LoginActivity::class.java).use { scenario ->
            instrumentation.waitForIdleSync()
            scenario.onActivity { activity ->
                assertEquals(
                    "Login must start focused on a D-pad actionable control",
                    activity.getString(R.string.login_add_playlist),
                    (activity.currentFocus as? Button)?.text?.toString()
                )
            }
            instrumentation.sendKeyDownUpSync(KeyEvent.KEYCODE_DPAD_UP)
            instrumentation.waitForIdleSync()
            scenario.onActivity { activity ->
                assertEquals(
                    "UP must reach remote-reachable refresh in the header",
                    activity.getString(R.string.refresh_from_website),
                    (activity.currentFocus as? Button)?.text?.toString()
                )
            }
            instrumentation.sendKeyDownUpSync(KeyEvent.KEYCODE_DPAD_DOWN)
            instrumentation.waitForIdleSync()
            scenario.onActivity { activity ->
                assertEquals(
                    "DOWN must return to playlist action controls",
                    activity.getString(R.string.login_add_playlist),
                    (activity.currentFocus as? Button)?.text?.toString()
                )
                assertTrue("Focused login button is enabled", activity.currentFocus?.isEnabled == true)
            }
        }
    }
}
