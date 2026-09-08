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

    override fun onActivityResumed(activity: Activity) {
        if (checkedThisProcess || activity !is HomeActivity) return
        checkedThisProcess = true
        activity.lifecycleScope.launch {
            delay(HOME_SETTLE_MS)
            if (!activity.isFinishing && !activity.isDestroyed) AppUpdatePrompt.check(activity)
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
