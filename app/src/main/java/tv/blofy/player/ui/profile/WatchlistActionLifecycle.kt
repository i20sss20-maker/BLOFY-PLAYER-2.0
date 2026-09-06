package tv.blofy.player.ui.profile

import android.app.Activity
import android.app.Application
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.FrameLayout
import tv.blofy.player.data.profile.ProfileLibraryStore
import tv.blofy.player.ui.details.MovieDetailsActivity
import tv.blofy.player.ui.details.SeriesDetailsActivity

/**
 * Adds a profile-scoped Watchlist action to movie/series details without touching playback.
 * The action is intentionally layered at the Activity UI boundary so Media3/FFmpeg and URL
 * resolution remain completely unchanged.
 */
class WatchlistActionLifecycle : Application.ActivityLifecycleCallbacks {
    override fun onActivityResumed(activity: Activity) {
        if (activity !is MovieDetailsActivity && activity !is SeriesDetailsActivity) return
        install(activity)
    }

    override fun onActivityPaused(activity: Activity) = Unit
    override fun onActivityCreated(activity: Activity, savedInstanceState: Bundle?) = Unit
    override fun onActivityStarted(activity: Activity) = Unit
    override fun onActivityStopped(activity: Activity) = Unit
    override fun onActivitySaveInstanceState(activity: Activity, outState: Bundle) = Unit
    override fun onActivityDestroyed(activity: Activity) = Unit

    private fun install(activity: Activity) {
        val contentKey = activity.intent.getStringExtra(EXTRA_CONTENT_KEY).orEmpty()
        if (contentKey.isBlank()) return
        val contentRoot = activity.findViewById<ViewGroup>(android.R.id.content) ?: return
        if (contentRoot.findViewWithTag<View>(TAG) != null) return

        val button = Button(activity).apply {
            tag = TAG
            isAllCaps = false
            textSize = 13f
            setTextColor(Color.WHITE)
            gravity = Gravity.CENTER
            isFocusable = true
            isFocusableInTouchMode = true
            elevation = dp(activity, 14).toFloat()
            setPadding(dp(activity, 16), 0, dp(activity, 16), 0)
            updateState(this, activity, contentKey)
            setOnClickListener {
                val enabled = !ProfileLibraryStore.isWatchlisted(activity, contentKey)
                ProfileLibraryStore.setWatchlisted(activity, contentKey, enabled)
                updateState(this, activity, contentKey)
            }
            setOnFocusChangeListener { view, focused ->
                view.background = background(activity, focused)
                view.animate().cancel()
                view.animate().scaleX(if (focused) 1.04f else 1f).scaleY(if (focused) 1.04f else 1f)
                    .translationZ(if (focused) dp(activity, 18).toFloat() else dp(activity, 10).toFloat())
                    .setDuration(70).start()
            }
        }

        val params = when (contentRoot) {
            is FrameLayout -> FrameLayout.LayoutParams(dp(activity, 180), dp(activity, 50), Gravity.TOP or Gravity.END).apply {
                topMargin = dp(activity, 22)
                marginEnd = dp(activity, 28)
            }
            else -> ViewGroup.LayoutParams(dp(activity, 180), dp(activity, 50))
        }
        contentRoot.addView(button, params)
    }

    private fun updateState(button: Button, activity: Activity, contentKey: String) {
        val saved = ProfileLibraryStore.isWatchlisted(activity, contentKey)
        val rtl = activity.resources.configuration.layoutDirection == View.LAYOUT_DIRECTION_RTL
        button.text = when {
            saved && rtl -> "✓ في قائمتي"
            saved -> "✓ In My List"
            rtl -> "+ أضف لقائمتي"
            else -> "+ My List"
        }
        button.background = background(activity, button.hasFocus())
        button.contentDescription = button.text
    }

    private fun background(activity: Activity, focused: Boolean) = GradientDrawable(
        GradientDrawable.Orientation.LEFT_RIGHT,
        if (focused) intArrayOf(0xFFA653FF.toInt(), 0xFF7130D2.toInt())
        else intArrayOf(0xE62B203B.toInt(), 0xEE17111F.toInt())
    ).apply {
        cornerRadius = dp(activity, 15).toFloat()
        setStroke(dp(activity, if (focused) 2 else 1), if (focused) 0xFFC897FF.toInt() else 0x99513C67.toInt())
    }

    private fun dp(activity: Activity, value: Int) = (value * activity.resources.displayMetrics.density).toInt()

    companion object {
        private const val EXTRA_CONTENT_KEY = "content_key"
        private const val TAG = "blofy_profile_watchlist_action"
    }
}
