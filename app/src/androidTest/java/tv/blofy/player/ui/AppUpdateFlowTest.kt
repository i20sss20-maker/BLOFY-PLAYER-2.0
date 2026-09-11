package tv.blofy.player.ui

import android.content.Intent
import android.os.SystemClock
import android.view.KeyEvent
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import androidx.core.content.FileProvider
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith
import tv.blofy.player.BuildConfig
import tv.blofy.player.R
import tv.blofy.player.core.update.AppUpdateActivity
import tv.blofy.player.core.update.AppUpdateWorker
import tv.blofy.player.core.update.UpdatePackageVerifier
import java.io.File

@RunWith(AndroidJUnit4::class)
class AppUpdateFlowTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val context = instrumentation.targetContext

    @Test fun installedVersionCannotBeReinstalledAsANewUpdate() {
        assertFalse(UpdatePackageVerifier.verify(context, File(context.applicationInfo.sourceDir), BuildConfig.VERSION_CODE))
        try {
            FileProvider.getUriForFile(context, "${context.packageName}.updates", File(context.filesDir, "private-account.json"))
            fail("The update provider exposed a file outside its download directory")
        } catch (_: IllegalArgumentException) { /* Expected restricted path. */ }
    }

    @Test fun verifiedCachedUpdateReachesAndroidConfirmation() {
        assumeTrue(InstrumentationRegistry.getArguments().getString("updateFixture") == "true")
        val version = BuildConfig.VERSION_CODE + 1
        assertTrue("Prepare the locally signed future-version fixture first",
            UpdatePackageVerifier.verify(context, AppUpdateWorker.file(context, version), version))
        val intent = Intent(context, AppUpdateActivity::class.java)
            .putExtra(AppUpdateWorker.VERSION, version)
            .putExtra(AppUpdateWorker.URL, "https://github.com/i20sss20-maker/BLOFY-PLAYER-2.0/releases/download/qa/fixture.apk")
            .putExtra("name", "BLOFY • QA update")
        ActivityScenario.launch<AppUpdateActivity>(intent).use { scenario ->
            var ready = false
            repeat(100) {
                if (!ready) {
                    scenario.onActivity { activity ->
                        ready = descendants(activity.window.decorView).filterIsInstance<Button>()
                            .any { it.isEnabled && it.text == activity.getString(R.string.update_install) }
                    }
                    SystemClock.sleep(150)
                }
            }
            assertTrue("Verified update never became installable", ready)
            screenshot("rc36-update-ready")
            scenario.onActivity { activity -> descendants(activity.window.decorView).filterIsInstance<Button>()
                .first { it.text == activity.getString(R.string.update_install) }.performClick() }
            var installerVisible = false
            repeat(100) {
                if (!installerVisible) {
                    val window = instrumentation.uiAutomation.rootInActiveWindow
                    val name = window?.packageName?.toString().orEmpty()
                    installerVisible = (name.contains("packageinstaller") || name.contains("permissioncontroller")) &&
                        listOf("Update", "Install", "تحديث", "تثبيت").any { label ->
                            window?.findAccessibilityNodeInfosByText(label)?.any {
                                it.isEnabled && it.isClickable && it.text?.toString().equals(label, ignoreCase = true)
                            } == true
                        }
                    SystemClock.sleep(150)
                }
            }
            screenshot("rc36-update-system-confirmation")
            assertTrue("Android installation confirmation did not open", installerVisible)
            // Never install the deliberately minimal fixture over the application under test.
            instrumentation.sendKeyDownUpSync(KeyEvent.KEYCODE_BACK)
        }
    }

    private fun descendants(view: View): List<View> = listOf(view) + if (view is ViewGroup)
        (0 until view.childCount).flatMap { descendants(view.getChildAt(it)) } else emptyList()
    private fun screenshot(name: String) {
        val file = File(context.getExternalFilesDir(null), "mobile-qa/$name.png")
        file.parentFile!!.mkdirs()
        file.outputStream().use { instrumentation.uiAutomation.takeScreenshot().compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it) }
    }
}
