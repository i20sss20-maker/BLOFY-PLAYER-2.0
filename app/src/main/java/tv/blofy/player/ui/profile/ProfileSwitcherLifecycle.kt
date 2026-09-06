package tv.blofy.player.ui.profile

import android.app.Activity
import android.app.Application
import android.content.Intent
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.widget.Button
import android.widget.FrameLayout
import tv.blofy.player.core.device.DeviceClass
import tv.blofy.player.core.profile.ProfileStore
import tv.blofy.player.ui.common.BlofyTvDesign
import tv.blofy.player.ui.home.HomeActivity

/** Lightweight Home entry point for profile switching without coupling profiles to playback. */
class ProfileSwitcherLifecycle : Application.ActivityLifecycleCallbacks {
    override fun onActivityCreated(activity: Activity, savedInstanceState: Bundle?) {
        if (activity is HomeActivity) install(activity)
    }

    override fun onActivityResumed(activity: Activity) {
        if (activity is HomeActivity) update(activity)
    }

    private fun install(activity: HomeActivity) {
        val content = activity.findViewById<FrameLayout>(android.R.id.content) ?: return
        if (content.findViewWithTag<View>(TAG) != null) return
        val density = activity.resources.displayMetrics.density
        fun dp(value: Int) = (value * density).toInt()
        val kind = DeviceClass.detect(activity)
        val button = Button(activity).apply {
            tag = TAG
            isAllCaps = false
            isFocusable = true
            isFocusableInTouchMode = kind == DeviceClass.Kind.TV
            typeface = BlofyTvDesign.BodyTypeface
            textSize = if (kind == DeviceClass.Kind.PHONE) 12f else 13f
            setTextColor(BlofyTvDesign.TextPrimary)
            background = BlofyTvDesign.elevatedSurface(dp(15).toFloat())
            if (kind == DeviceClass.Kind.TV) BlofyTvDesign.installTvFocus(this, dp(15).toFloat(), 1.03f, false) {}
            setOnClickListener { activity.startActivity(Intent(activity, ProfilesActivity::class.java)) }
        }
        val width = if (kind == DeviceClass.Kind.PHONE) dp(132) else dp(176)
        val height = if (kind == DeviceClass.Kind.PHONE) dp(42) else dp(46)
        content.addView(button, FrameLayout.LayoutParams(width, height, Gravity.TOP or Gravity.END).apply {
            topMargin = dp(if (kind == DeviceClass.Kind.PHONE) 10 else 14)
            marginEnd = dp(if (kind == DeviceClass.Kind.PHONE) 12 else 22)
        })
        update(activity)
    }

    private fun update(activity: HomeActivity) {
        val button = activity.findViewById<FrameLayout>(android.R.id.content)
            ?.findViewWithTag<Button>(TAG) ?: return
        val profile = ProfileStore.active(activity)
        button.text = (if (profile.kids) "🧒  " else if (profile.guest) "◌  " else "●  ") + profile.name
    }

    override fun onActivityStarted(activity: Activity) = Unit
    override fun onActivityPaused(activity: Activity) = Unit
    override fun onActivityStopped(activity: Activity) = Unit
    override fun onActivitySaveInstanceState(activity: Activity, outState: Bundle) = Unit
    override fun onActivityDestroyed(activity: Activity) = Unit

    companion object { private const val TAG = "blofy_active_profile_switcher" }
}
