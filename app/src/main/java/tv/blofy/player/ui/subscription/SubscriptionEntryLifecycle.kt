package tv.blofy.player.ui.subscription

import android.app.Activity
import android.app.Application
import android.content.Intent
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.widget.Button
import android.widget.FrameLayout
import tv.blofy.player.ui.common.BlofyTvDesign
import tv.blofy.player.ui.settings.SettingsActivity

/** Adds a commercial subscription entry without coupling playback/settings internals to billing. */
class SubscriptionEntryLifecycle : Application.ActivityLifecycleCallbacks {
    override fun onActivityCreated(activity: Activity, savedInstanceState: Bundle?) {
        if (activity !is SettingsActivity) return
        val root = activity.findViewById<FrameLayout>(android.R.id.content) ?: return
        if (root.findViewWithTag<View>(TAG) != null) return
        val density = activity.resources.displayMetrics.density
        fun dp(value: Int) = (value * density).toInt()
        val button = Button(activity).apply {
            tag = TAG
            text = "BLOFY PLUS  •  Subscription"
            isAllCaps = false
            isFocusable = true
            typeface = BlofyTvDesign.HeadingTypeface
            textSize = 13.5f
            setTextColor(BlofyTvDesign.TextPrimary)
            background = BlofyTvDesign.elevatedSurface(dp(18).toFloat())
            BlofyTvDesign.installTvFocus(this, dp(18).toFloat(), 1.025f, false) {}
            setOnClickListener { activity.startActivity(Intent(activity, SubscriptionActivity::class.java)) }
        }
        root.addView(button, FrameLayout.LayoutParams(dp(250), dp(52), Gravity.BOTTOM or Gravity.END).apply {
            marginEnd = dp(34)
            bottomMargin = dp(18)
        })
    }

    override fun onActivityStarted(activity: Activity) = Unit
    override fun onActivityResumed(activity: Activity) = Unit
    override fun onActivityPaused(activity: Activity) = Unit
    override fun onActivityStopped(activity: Activity) = Unit
    override fun onActivitySaveInstanceState(activity: Activity, outState: Bundle) = Unit
    override fun onActivityDestroyed(activity: Activity) = Unit

    companion object { private const val TAG = "blofy_subscription_entry" }
}
