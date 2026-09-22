package tv.blofy.player.ui.profile

import android.app.Activity
import tv.blofy.player.ui.common.CinemaStyle
import tv.blofy.player.ui.common.BlofyTvDesign
import tv.blofy.player.ui.common.TvUiTuning
import android.app.Application
import android.graphics.Color
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.widget.Button
import android.widget.FrameLayout
import android.widget.LinearLayout
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
            textSize = 12f
            typeface = BlofyTvDesign.LabelTypeface
            setTextColor(CinemaStyle.White)
            gravity = Gravity.CENTER
            isFocusable = true
            isFocusableInTouchMode = tv.blofy.player.core.device.DeviceClass.isTv(activity)
            elevation = 0f
            minHeight = 0; minimumHeight = 0; minWidth = 0; minimumWidth = 0
            stateListAnimator = null
            setPadding(dp(activity, 16), 0, dp(activity, 16), 0)

            fun refresh() {
                val saved = ProfileLibraryStore.isWatchlisted(activity, contentKey)
                val arabic = androidx.core.os.ConfigurationCompat.getLocales(activity.resources.configuration)[0]?.language == "ar"
                text = when {
                    arabic && saved -> "✓ في قائمتي"
                    arabic -> "+ قائمتي"
                    saved -> "✓ My Watchlist"
                    else -> "+ My Watchlist"
                }
                background = CinemaStyle.buttonBackground(activity, false, hasFocus())
                setTextColor(CinemaStyle.White)
            }
            setOnFocusChangeListener { view, focused ->
                view.background = CinemaStyle.buttonBackground(activity, false, focused)
                setTextColor(CinemaStyle.White)
                view.animate().cancel()
                val targetScale = if (focused) TvUiTuning.focusScale(activity, 1.024f) else 1f
                view.animate()
                    .scaleX(targetScale)
                    .scaleY(targetScale)
                    .translationZ(if (focused) TvUiTuning.focusElevation(activity, dp(activity, 7).toFloat()) else 0f)
                    .setDuration(TvUiTuning.focusDuration(activity, focused))
                    .start()
            }
            setOnClickListener {
                val next = !ProfileLibraryStore.isWatchlisted(activity, contentKey)
                ProfileLibraryStore.setWatchlisted(activity, contentKey, next)
                refresh()
            }
            refresh()
        }

        val actions = host.findViewWithTag<LinearLayout>("blofy_details_profile_actions") ?: return
        val tv = tv.blofy.player.core.device.DeviceClass.isTv(activity)
        button.isFocusableInTouchMode = tv
        actions.addView(button, LinearLayout.LayoutParams(
            dp(activity, if (tv) 132 else 140),
            dp(activity, if (tv) CinemaStyle.ActionHeight else 48)
        ).apply {
            marginStart = dp(activity, 8)
        })
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
