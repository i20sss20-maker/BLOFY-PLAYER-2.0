package tv.blofy.player.ui

import android.graphics.BitmapFactory
import android.view.KeyEvent
import android.view.View
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
import tv.blofy.player.BuildConfig
import tv.blofy.player.R
import tv.blofy.player.core.device.DeviceClass
import tv.blofy.player.data.local.ProviderEntity
import tv.blofy.player.ui.login.LoginActivity

/** Test actual Google TV launcher assets and physical D-pad focus, never only source regex. */
@RunWith(AndroidJUnit4::class)
class AndroidTvV74ReviewTest {
    private val instrumentation get() = InstrumentationRegistry.getInstrumentation()
    private val context get() = instrumentation.targetContext

    @Before fun tvOnly() {
        assumeTrue(InstrumentationRegistry.getArguments().getString("tvReview") == "true")
        assumeTrue(DeviceClass.isTv(context))
        assertTrue("Review must exercise the Play build", BuildConfig.IS_GOOGLE_PLAY)
    }

    @Test fun tvBannerAndIconAreRealBitmaps() {
        val opts = BitmapFactory.Options().apply { inScaled = false }
        val banner = BitmapFactory.decodeResource(context.resources, R.drawable.blofy_tv_banner, opts)
        assertNotNull("Launcher banner must not be an XML placeholder", banner)
        assertEquals(320, banner.width)
        assertEquals(180, banner.height)
        banner.recycle()

        val icon = BitmapFactory.decodeResource(context.resources, R.drawable.blofy_logo, opts)
        assertNotNull(icon)
        assertEquals(512, icon.width)
        assertEquals(512, icon.height)
        icon.recycle()

        assertEquals(R.drawable.blofy_tv_banner, context.applicationInfo.banner)
        assertEquals(R.drawable.blofy_logo, context.applicationInfo.icon)
    }

    @Test fun dpadMovesBetweenPrimaryActionAndHeaderBothWays() {
        ActivityScenario.launch(LoginActivity::class.java).use { scenario ->
            instrumentation.waitForIdleSync()
            scenario.onActivity { a ->
                assertEquals(a.getString(R.string.login_add_playlist), (a.currentFocus as? Button)?.text?.toString())
            }
            instrumentation.sendKeyDownUpSync(KeyEvent.KEYCODE_DPAD_UP)
            instrumentation.waitForIdleSync()
            scenario.onActivity { a ->
                assertEquals(a.getString(R.string.refresh_from_website), (a.currentFocus as? Button)?.text?.toString())
            }
            instrumentation.sendKeyDownUpSync(KeyEvent.KEYCODE_DPAD_DOWN)
            instrumentation.waitForIdleSync()
            scenario.onActivity { a ->
                assertEquals(a.getString(R.string.login_add_playlist), (a.currentFocus as? Button)?.text?.toString())
                assertTrue(a.currentFocus?.isEnabled == true)
            }
            instrumentation.sendKeyDownUpSync(KeyEvent.KEYCODE_DPAD_UP)
            var accountDirection = KeyEvent.KEYCODE_DPAD_RIGHT
            scenario.onActivity { a ->
                accountDirection = if (a.resources.configuration.layoutDirection == View.LAYOUT_DIRECTION_RTL)
                    KeyEvent.KEYCODE_DPAD_LEFT else KeyEvent.KEYCODE_DPAD_RIGHT
            }
            instrumentation.sendKeyDownUpSync(accountDirection)
            instrumentation.waitForIdleSync()
            scenario.onActivity { a ->
                assertEquals(a.getString(R.string.account_title), (a.currentFocus as? Button)?.text?.toString())
            }
        }
    }
    @Test fun dpadNavigatesEverySavedPlaylistWithoutSkippingTheScroll() {
        // Test in-memory cards so this never changes the user's accounts or playlists.
        val first = ProviderEntity(
            id = "tv-review-remote-first", name = "Remote first",
            baseUrl = "http://127.0.0.1:9", username = "test", password = "",
            updatedAt = 200L
        )
        val second = first.copy(id = "tv-review-remote-second", name = "Remote second", updatedAt = 100L)
        ActivityScenario.launch(LoginActivity::class.java).use { scenario ->
            scenario.onActivity { a ->
                a.renderPortalPlaylists(listOf(first, second))
                assertTrue(a.findViewWithTag<View>(first.id).requestFocus())
            }
            instrumentation.waitForIdleSync()
            scenario.onActivity { a -> assertEquals(first.id, a.currentFocus?.tag) }

            instrumentation.sendKeyDownUpSync(KeyEvent.KEYCODE_DPAD_DOWN)
            scenario.onActivity { a -> assertEquals(second.id, a.currentFocus?.tag) }

            instrumentation.sendKeyDownUpSync(KeyEvent.KEYCODE_DPAD_DOWN)
            scenario.onActivity { a ->
                assertEquals(a.getString(R.string.login_add_playlist), (a.currentFocus as? Button)?.text?.toString())
            }

            instrumentation.sendKeyDownUpSync(KeyEvent.KEYCODE_DPAD_UP)
            scenario.onActivity { a -> assertEquals(second.id, a.currentFocus?.tag) }

            instrumentation.sendKeyDownUpSync(KeyEvent.KEYCODE_DPAD_UP)
            scenario.onActivity { a -> assertEquals(first.id, a.currentFocus?.tag) }

            instrumentation.sendKeyDownUpSync(KeyEvent.KEYCODE_DPAD_UP)
            scenario.onActivity { a ->
                assertEquals(a.getString(R.string.refresh_from_website), (a.currentFocus as? Button)?.text?.toString())
            }
            instrumentation.sendKeyDownUpSync(KeyEvent.KEYCODE_DPAD_DOWN)
            scenario.onActivity { a -> assertEquals(first.id, a.currentFocus?.tag) }

            // Updating saved cards must keep the chosen card and rebind its new view ID.
            scenario.onActivity { a ->
                a.renderPortalPlaylists(listOf(first.copy(name = "Remote first updated"), second))
                assertEquals(first.id, a.currentFocus?.tag)
                assertTrue(a.currentFocus?.isClickable == true)
            }
            instrumentation.sendKeyDownUpSync(KeyEvent.KEYCODE_DPAD_DOWN)
            scenario.onActivity { a -> assertEquals(second.id, a.currentFocus?.tag) }
        }
    }
}
