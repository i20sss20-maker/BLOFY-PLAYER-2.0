package tv.blofy.player.ui

import android.content.Intent
import android.graphics.Bitmap
import android.os.SystemClock
import android.view.KeyEvent
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import tv.blofy.player.core.identity.DeviceIdentity
import tv.blofy.player.ui.login.LoginActivity
import java.io.File
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

@RunWith(AndroidJUnit4::class)
class StartupRecoveryDeviceTest {
    @Test fun loginDrawsWhileIdentityStorageIsBlocked() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val context = instrumentation.targetContext
        val evidence = File(context.getExternalFilesDir(null), "artwork-qa").apply { mkdirs() }
        val locked = CountDownLatch(1)
        val release = CountDownLatch(1)
        val timedOut = AtomicBoolean(false)
        val writer = Thread {
            synchronized(DeviceIdentity) {
                locked.countDown()
                timedOut.set(!release.await(8, TimeUnit.SECONDS))
            }
        }.apply { isDaemon = true; start() }
        assertTrue(locked.await(2, TimeUnit.SECONDS))
        var scenario: ActivityScenario<LoginActivity>? = null
        val started = SystemClock.elapsedRealtime()
        try {
            scenario = ActivityScenario.launch(Intent(context, LoginActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            scenario.onActivity { activity ->
                val root = activity.window.decorView
                assertTrue(root.isShown)
                assertTrue(root.width > 0 && root.height > 0)
                assertTrue(descendants(root).filterIsInstance<Button>().any { it.isEnabled && it.isShown })
            }
            instrumentation.sendKeyDownUpSync(KeyEvent.KEYCODE_DPAD_RIGHT)
            instrumentation.waitForIdleSync()
            assertFalse("The first Login frame waited for the identity monitor", timedOut.get())
            val elapsed = SystemClock.elapsedRealtime() - started
            instrumentation.uiAutomation.takeScreenshot().let { bitmap ->
                File(evidence, "login-storage-blocked.png").outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
                bitmap.recycle()
            }
            assertFalse("Login was not responsive before the writer released", timedOut.get())
            File(evidence, "startup-blocked-result.txt").writeText(
                "identity_lock_held=true\nfirst_frame_and_input_before_release=true\nelapsed_ms=$elapsed\nwatchdog_ms=8000\n")
        } finally {
            release.countDown()
            writer.join(2_000)
            scenario?.close()
        }
    }

    private fun descendants(view: View): Sequence<View> = sequence {
        yield(view)
        if (view is ViewGroup) for (index in 0 until view.childCount) yieldAll(descendants(view.getChildAt(index)))
    }
}
