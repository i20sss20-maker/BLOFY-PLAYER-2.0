package tv.blofy.player.core.update

import android.app.Activity
import android.app.Application
import android.os.Bundle
import tv.blofy.player.ui.home.HomeActivity

/** Starts one non-blocking update check when the main screen becomes visible. */
class AppUpdateLifecycle : Application.ActivityLifecycleCallbacks {
    private var checkedThisProcess = false

    override fun onActivityResumed(activity: Activity) {
        if (checkedThisProcess || activity !is HomeActivity) return
        checkedThisProcess = true
        AppUpdatePrompt.check(activity)
    }

    override fun onActivityCreated(activity: Activity, savedInstanceState: Bundle?) = Unit
    override fun onActivityStarted(activity: Activity) = Unit
    override fun onActivityPaused(activity: Activity) = Unit
    override fun onActivityStopped(activity: Activity) = Unit
    override fun onActivitySaveInstanceState(activity: Activity, outState: Bundle) = Unit
    override fun onActivityDestroyed(activity: Activity) = Unit
}
