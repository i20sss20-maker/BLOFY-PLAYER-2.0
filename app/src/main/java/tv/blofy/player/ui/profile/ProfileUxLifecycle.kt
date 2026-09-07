package tv.blofy.player.ui.profile

import android.app.Activity
import android.app.Application
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.widget.Button
import android.widget.FrameLayout
import tv.blofy.player.core.profile.ProfileStore
import tv.blofy.player.data.profile.ProfileLibraryStore
import tv.blofy.player.ui.details.MovieDetailsActivity
import tv.blofy.player.ui.details.SeriesDetailsActivity
import tv.blofy.player.ui.home.HomeActivity

/**
 * Profile-owned UI enhancements that stay completely above playback/catalog engines.
 *
 * - Adds a per-profile Watchlist action to movie/series detail screens without touching player code.
 * - Applies a conservative visual Kids Mode pass on Home so clearly adult-labelled cards are not shown.
 */
class ProfileUxLifecycle : Application.ActivityLifecycleCallbacks {
    private val homeFilters = java.util.WeakHashMap<Activity, KidsHomeFilter>()
    override fun onActivityResumed(activity: Activity) {
        when (activity) {
            is MovieDetailsActivity, is SeriesDetailsActivity -> installWatchlistAction(activity)
            is HomeActivity -> {
                homeFilters.remove(activity)?.detach()
                val appContext = activity.applicationContext
                homeFilters[activity] = KidsHomeFilter(activity.window.decorView) {
                    ProfileStore.isKids(appContext)
                }.also { it.attach() }
            }
        }
    }

    private fun installWatchlistAction(activity: Activity) {
        val contentKey = activity.intent?.getStringExtra("content_key").orEmpty()
        if (contentKey.isBlank()) return
        val host = activity.findViewById<FrameLayout>(android.R.id.content) ?: return
        if (host.findViewWithTag<View>(WATCHLIST_TAG) != null) return

        val button = Button(activity).apply {
            tag = WATCHLIST_TAG
            isAllCaps = false
            textSize = 13.5f
            setTextColor(Color.WHITE)
            gravity = Gravity.CENTER
            isFocusable = true
            isFocusableInTouchMode = true
            elevation = dp(activity, 10).toFloat()
            setPadding(dp(activity, 16), 0, dp(activity, 16), 0)

            fun refresh() {
                val saved = ProfileLibraryStore.isWatchlisted(activity, contentKey)
                text = if (saved) "✓ My Watchlist" else "+ My Watchlist"
                background = buttonBackground(activity, saved, hasFocus())
            }
            setOnFocusChangeListener { view, focused ->
                val saved = ProfileLibraryStore.isWatchlisted(activity, contentKey)
                view.background = buttonBackground(activity, saved, focused)
                view.animate().cancel()
                view.animate().scaleX(if (focused) 1.035f else 1f).scaleY(if (focused) 1.035f else 1f)
                    .translationZ(if (focused) dp(activity, 14).toFloat() else dp(activity, 8).toFloat())
                    .setDuration(70).start()
            }
            setOnClickListener {
                val next = !ProfileLibraryStore.isWatchlisted(activity, contentKey)
                ProfileLibraryStore.setWatchlisted(activity, contentKey, next)
                refresh()
            }
            refresh()
        }

        host.addView(button, FrameLayout.LayoutParams(dp(activity, 178), dp(activity, 52), Gravity.BOTTOM or Gravity.END).apply {
            marginEnd = dp(activity, 42)
            bottomMargin = dp(activity, 28)
        })
    }

    private fun buttonBackground(activity: Activity, saved: Boolean, focused: Boolean) = GradientDrawable(
        GradientDrawable.Orientation.LEFT_RIGHT,
        when {
            focused -> intArrayOf(0xFFA653FF.toInt(), 0xFF7130D2.toInt())
            saved -> intArrayOf(0xFF5D3284.toInt(), 0xFF352047.toInt())
            else -> intArrayOf(0xE62B203B.toInt(), 0xE61A1325.toInt())
        }
    ).apply {
        cornerRadius = dp(activity, 15).toFloat()
        setStroke(dp(activity, if (focused) 2 else 1), if (focused) 0xFFC897FF.toInt() else 0x99513C67.toInt())
    }

    private fun dp(activity: Activity, value: Int) = (value * activity.resources.displayMetrics.density).toInt()

    override fun onActivityCreated(activity: Activity, savedInstanceState: Bundle?) = Unit
    override fun onActivityStarted(activity: Activity) = Unit
    override fun onActivityPaused(activity: Activity) { homeFilters.remove(activity)?.detach() }
    override fun onActivityStopped(activity: Activity) = Unit
    override fun onActivitySaveInstanceState(activity: Activity, outState: Bundle) = Unit
    override fun onActivityDestroyed(activity: Activity) { onActivityPaused(activity) }

    companion object { private const val WATCHLIST_TAG = "blofy_profile_watchlist_action" }
}
