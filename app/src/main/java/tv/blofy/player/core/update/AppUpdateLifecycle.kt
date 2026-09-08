package tv.blofy.player.core.update

import android.app.Activity
import android.app.Application
import android.os.Bundle
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import tv.blofy.player.ui.home.HomeActivity

/** Runs the one-per-process update check only after Home has had time to become interactive. */
class AppUpdateLifecycle : Application.ActivityLifecycleCallbacks {
    private var checkedThisProcess = false
    private var checkScheduled = false

    override fun onActivityResumed(activity: Activity) {
        if (checkedThisProcess || checkScheduled || activity !is HomeActivity) return
        checkScheduled = true
        activity.lifecycleScope.launch {
            try {
                delay(HOME_SETTLE_MS)
                if (!activity.isFinishing && !activity.isDestroyed) {
                    // Consume the once-per-process allowance only when the check really starts. If
                    // Home disappears during the settle delay, a later Home can still schedule it.
                    checkedThisProcess = true
                    AppUpdatePrompt.check(activity)
                }
            } finally {
                checkScheduled = false
            }
        }
    }

    override fun onActivityCreated(activity: Activity, savedInstanceState: Bundle?) = Unit
    override fun onActivityStarted(activity: Activity) = Unit
    override fun onActivityPaused(activity: Activity) = Unit
    override fun onActivityStopped(activity: Activity) = Unit
    override fun onActivitySaveInstanceState(activity: Activity, outState: Bundle) = Unit
    override fun onActivityDestroyed(activity: Activity) = Unit

    companion object { private const val HOME_SETTLE_MS = 4_000L }
}
