package tv.blofy.player.ui.quick

import android.app.Activity
import android.app.Application
import android.content.Intent
import android.os.Bundle
import android.view.KeyEvent
import androidx.appcompat.view.WindowCallbackWrapper
import tv.blofy.player.ui.player.PlayerActivity

/** Installs a lightweight global remote shortcut without changing each screen. */
object GlobalQuickMenuKeys : Application.ActivityLifecycleCallbacks {
    private val installed = java.util.WeakHashMap<Activity, android.view.Window.Callback>()

    fun install(application: Application) {
        application.registerActivityLifecycleCallbacks(this)
    }

    override fun onActivityResumed(activity: Activity) {
        if (activity is QuickMenuActivity) return
        if (installed.containsKey(activity)) return
        val original = activity.window.callback ?: return
        installed[activity] = original
        activity.window.callback = object : WindowCallbackWrapper(original) {
            private var okDownAt = 0L

            override fun dispatchKeyEvent(event: KeyEvent): Boolean {
                if (event.keyCode == KeyEvent.KEYCODE_MENU && event.action == KeyEvent.ACTION_DOWN && event.repeatCount == 0) {
                    open(activity)
                    return true
                }

                val okKey = event.keyCode == KeyEvent.KEYCODE_DPAD_CENTER || event.keyCode == KeyEvent.KEYCODE_ENTER || event.keyCode == KeyEvent.KEYCODE_NUMPAD_ENTER
                if (okKey && activity !is PlayerActivity) {
                    if (event.action == KeyEvent.ACTION_DOWN && event.repeatCount == 0) okDownAt = event.eventTime
                    if (event.action == KeyEvent.ACTION_DOWN && (event.isLongPress || event.repeatCount >= 2 || (okDownAt > 0 && event.eventTime - okDownAt >= 650L))) {
                        okDownAt = 0L
                        open(activity)
                        return true
                    }
                    if (event.action == KeyEvent.ACTION_UP) okDownAt = 0L
                }
                return super.dispatchKeyEvent(event)
            }
        }
    }

    private fun open(activity: Activity) {
        activity.startActivity(Intent(activity, QuickMenuActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_REORDER_TO_FRONT))
    }

    override fun onActivityDestroyed(activity: Activity) { installed.remove(activity) }
    override fun onActivityCreated(activity: Activity, savedInstanceState: Bundle?) = Unit
    override fun onActivityStarted(activity: Activity) = Unit
    override fun onActivityPaused(activity: Activity) = Unit
    override fun onActivityStopped(activity: Activity) = Unit
    override fun onActivitySaveInstanceState(activity: Activity, outState: Bundle) = Unit
}
