package tv.blofy.player.core.remote

import android.app.Activity
import android.app.Application
import android.content.Intent
import android.os.Bundle
import android.view.KeyEvent
import android.view.Window
import tv.blofy.player.ui.guide.LiveGuideActivity
import tv.blofy.player.ui.player.PlayerActivity
import tv.blofy.player.ui.quick.QuickMenuActivity

/** Installs one lightweight Window.Callback wrapper per Activity so TV quick access is consistent. */
class QuickMenuInterceptor : Application.ActivityLifecycleCallbacks {
    override fun onActivityResumed(activity: Activity) {
        if (activity is QuickMenuActivity) return
        val current = activity.window.callback ?: return
        if (current is Callback) return
        activity.window.callback = Callback(activity, current)
    }

    private class Callback(
        private val activity: Activity,
        private val original: Window.Callback
    ) : Window.Callback by original {
        private var centerDownAt = 0L
        private var openedForPress = false

        override fun dispatchKeyEvent(event: KeyEvent): Boolean {
            if (event.action == KeyEvent.ACTION_DOWN) {
                if (isMenuOrGuide(event.keyCode)) {
                    openContextMenu()
                    return true
                }
                if (isCenter(event.keyCode) && activity !is PlayerActivity) {
                    if (event.repeatCount == 0) {
                        centerDownAt = event.eventTime
                        openedForPress = false
                    } else if (!openedForPress && event.eventTime - centerDownAt >= LONG_PRESS_MS) {
                        openedForPress = true
                        openContextMenu()
                        return true
                    }
                }
            } else if (event.action == KeyEvent.ACTION_UP && isCenter(event.keyCode)) {
                if (openedForPress) {
                    openedForPress = false
                    return true
                }
            }
            return original.dispatchKeyEvent(event)
        }

        private fun openContextMenu() {
            if (activity.isFinishing || activity.isDestroyed) return
            val target = if (activity is PlayerActivity) {
                Intent(activity, LiveGuideActivity::class.java).apply {
                    putExtra(
                        LiveGuideActivity.EXTRA_CATEGORY_ID,
                        activity.intent.getStringExtra(PlayerActivity.EXTRA_CATEGORY_ID)
                    )
                    putExtra(
                        LiveGuideActivity.EXTRA_STREAM_ID,
                        activity.intent.getStringExtra(PlayerActivity.EXTRA_STREAM_ID)
                    )
                    addFlags(Intent.FLAG_ACTIVITY_REORDER_TO_FRONT)
                }
            } else {
                Intent(activity, QuickMenuActivity::class.java)
                    .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP)
            }
            activity.startActivity(target)
        }

        private fun isMenuOrGuide(code: Int) =
            code == KeyEvent.KEYCODE_MENU ||
                code == KeyEvent.KEYCODE_GUIDE ||
                code == KeyEvent.KEYCODE_TV_CONTENTS_MENU

        private fun isCenter(code: Int) =
            code == KeyEvent.KEYCODE_DPAD_CENTER ||
                code == KeyEvent.KEYCODE_ENTER ||
                code == KeyEvent.KEYCODE_NUMPAD_ENTER
    }

    override fun onActivityCreated(activity: Activity, savedInstanceState: Bundle?) = Unit
    override fun onActivityStarted(activity: Activity) = Unit
    override fun onActivityPaused(activity: Activity) = Unit
    override fun onActivityStopped(activity: Activity) = Unit
    override fun onActivitySaveInstanceState(activity: Activity, outState: Bundle) = Unit
    override fun onActivityDestroyed(activity: Activity) = Unit

    companion object { private const val LONG_PRESS_MS = 520L }
}
