package tv.blofy.player.ui.common

import android.app.Application
import android.content.DialogInterface
import android.os.Bundle
import android.os.Looper
import android.widget.LinearLayout
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.android.controller.ActivityController
import org.robolectric.annotation.Config
import tv.blofy.player.ui.home.HomeActivity
import tv.blofy.player.ui.login.LoginActivity
import tv.blofy.player.ui.playlist.ProviderManagerActivity
import tv.blofy.player.ui.player.PlayerActivity

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28], application = Application::class)
class RootExitConfirmationRegressionTest {
    private lateinit var controller: ActivityController<ExitTestActivity>
    private lateinit var activity: ExitTestActivity

    @Before fun setup() {
        controller = Robolectric.buildActivity(ExitTestActivity::class.java).setup()
        activity = controller.get()
        RootExitConfirmationLifecycle.install(activity)
    }

    @After fun cleanup() { controller.pause().stop().destroy() }

    private fun show(): AlertDialog {
        activity.onBackPressedDispatcher.onBackPressed()
        shadowOf(Looper.getMainLooper()).idle()
        return (activity.supportFragmentManager.findFragmentByTag(RootExitConfirmationLifecycle.DIALOG_TAG) as RootExitConfirmationDialog).dialog as AlertDialog
    }

    @Test fun onlyHomeAndLoginAreExitScreens() {
        assertTrue(RootExitConfirmationLifecycle.isRootScreen(HomeActivity::class.java))
        assertTrue(RootExitConfirmationLifecycle.isRootScreen(LoginActivity::class.java))
        assertFalse(RootExitConfirmationLifecycle.isRootScreen(ProviderManagerActivity::class.java))
        assertFalse(RootExitConfirmationLifecycle.isRootScreen(PlayerActivity::class.java))
        assertFalse(RootExitConfirmationLifecycle.isRootScreen(ExitTestActivity::class.java))
    }

    @Test fun backShowsYesNoAndDefaultsToNo() {
        val dialog = show()
        assertTrue(dialog.isShowing)
        assertEquals("نعم", dialog.getButton(DialogInterface.BUTTON_POSITIVE).text.toString())
        assertEquals("لا", dialog.getButton(DialogInterface.BUTTON_NEGATIVE).text.toString())
        assertTrue(dialog.getButton(DialogInterface.BUTTON_NEGATIVE).hasFocus())
        assertFalse(activity.isFinishing)
    }

    @Test fun repeatedBackDoesNotStackDialogs() {
        val first = show()
        assertSame(first, show())
        assertEquals(1, activity.supportFragmentManager.fragments.count { it is RootExitConfirmationDialog })
    }

    @Test fun noKeepsActivityAndSavedData() {
        val prefs = activity.getSharedPreferences("exit_test", 0)
        prefs.edit().putString("playlist", "keep-me").commit()
        show().getButton(DialogInterface.BUTTON_NEGATIVE).performClick()
        shadowOf(Looper.getMainLooper()).idle()
        assertFalse(activity.isFinishing)
        assertNull(activity.supportFragmentManager.findFragmentByTag(RootExitConfirmationLifecycle.DIALOG_TAG))
        assertEquals("keep-me", prefs.getString("playlist", null))
    }

    @Test fun dismissingDialogDoesNotExit() {
        show().cancel()
        shadowOf(Looper.getMainLooper()).idle()
        assertFalse(activity.isFinishing)
    }

    @Test fun yesFinishesTaskWithoutClearingSavedData() {
        val prefs = activity.getSharedPreferences("exit_test", 0)
        prefs.edit().putString("playlist", "keep-me").commit()
        show().getButton(DialogInterface.BUTTON_POSITIVE).performClick()
        shadowOf(Looper.getMainLooper()).idle()
        assertTrue(activity.isFinishing)
        assertEquals("keep-me", prefs.getString("playlist", null))
    }

    class ExitTestActivity : AppCompatActivity() {
        override fun onCreate(savedInstanceState: Bundle?) {
            setTheme(androidx.appcompat.R.style.Theme_AppCompat)
            super.onCreate(savedInstanceState)
            setContentView(LinearLayout(this))
        }
    }
}
