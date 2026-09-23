package tv.blofy.player.core.remote

import android.app.Activity
import android.app.Application
import android.content.Intent
import android.os.Bundle
import android.os.Handler
import android.os.Looper
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
        private val handler = Handler(Looper.getMainLooper())
        private var centerDownAt = 0L
        private var openedForPress = false
        private val longPress = Runnable {
            if (!openedForPress && activity.hasWindowFocus() && activity !is PlayerActivity) {
                openedForPress = true
                openContextMenu()
            }
        }

        override fun dispatchKeyEvent(event: KeyEvent): Boolean {
            if (event.action == KeyEvent.ACTION_DOWN) {
                if (isMenuOrGuide(event.keyCode)) {
                    handler.removeCallbacks(longPress)
                    openContextMenu()
                    return true
                }
                if (isCenter(event.keyCode) && activity !is PlayerActivity) {
                    if (event.repeatCount == 0) {
                        centerDownAt = event.eventTime
                        openedForPress = false
                        handler.removeCallbacks(longPress)
                        handler.postDelayed(longPress, LONG_PRESS_MS)
                    } else if (!openedForPress && event.eventTime - centerDownAt >= LONG_PRESS_MS) {
                        handler.removeCallbacks(longPress)
                        openedForPress = true
                        openContextMenu()
                        return true
                    } else if (openedForPress) {
                        return true
                    }
                }
            } else if (event.action == KeyEvent.ACTION_UP && isCenter(event.keyCode)) {
                handler.removeCallbacks(longPress)
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
                val focused = activity.currentFocus
                Intent(activity, QuickMenuActivity::class.java).apply {
                    addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP)
                    (focused?.tag as? String)?.takeIf(String::isNotBlank)?.let {
                        putExtra(QuickMenuActivity.EXTRA_CONTENT_KEY, it)
                    }
                    focused?.contentDescription?.toString()?.takeIf(String::isNotBlank)?.let {
                        putExtra(QuickMenuActivity.EXTRA_CONTEXT_LABEL, it)
                    }
                }
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

    companion object { private const val LONG_PRESS_MS = 460L }
}
