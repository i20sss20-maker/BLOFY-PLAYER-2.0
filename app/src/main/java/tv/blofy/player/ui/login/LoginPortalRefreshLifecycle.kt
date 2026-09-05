package tv.blofy.player.ui.login

import android.app.Activity
import android.app.Application
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.widget.Button
import android.widget.FrameLayout
import android.widget.Toast
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import tv.blofy.player.BuildConfig
import tv.blofy.player.R
import tv.blofy.player.core.device.DeviceClass
import tv.blofy.player.core.identity.PortalPlaylistClient
import tv.blofy.player.data.local.BlofyDatabase
import tv.blofy.player.ui.common.BlofyTvDesign

/** Adds an explicit pull-only website refresh button to the root login screen. */
class LoginPortalRefreshLifecycle : Application.ActivityLifecycleCallbacks {
    override fun onActivityCreated(activity: Activity, savedInstanceState: Bundle?) {
        if (activity is LoginActivity) install(activity)
    }

    private fun install(activity: LoginActivity) {
        val content = activity.findViewById<FrameLayout>(android.R.id.content) ?: return
        if (content.findViewWithTag<View>(TAG) != null) return
        val density = activity.resources.displayMetrics.density
        fun dp(value: Int) = (value * density).toInt()
        val kind = DeviceClass.detect(activity)
        val compact = kind == DeviceClass.Kind.PHONE
        val tablet = kind == DeviceClass.Kind.TABLET

        val button = Button(activity).apply {
            tag = TAG
            text = activity.getString(R.string.refresh_from_website)
            isAllCaps = false
            isFocusable = true
            isFocusableInTouchMode = kind == DeviceClass.Kind.TV
            typeface = BlofyTvDesign.BodyTypeface
            textSize = if (compact) 12.5f else 14f
            setTextColor(BlofyTvDesign.TextPrimary)
            background = BlofyTvDesign.elevatedSurface(dp(if (compact) 13 else 16).toFloat())
            if (kind == DeviceClass.Kind.TV) {
                BlofyTvDesign.installTvFocus(this, dp(16).toFloat(), 1.03f, false) {}
            }
            setOnClickListener {
                if (!isEnabled) return@setOnClickListener
                activity.lifecycleScope.launch {
                    isEnabled = false
                    text = activity.getString(R.string.refreshing_from_website)
                    try {
                        val endpoint = BuildConfig.ACTIVATION_BASE_URL.trim()
                        val dao = BlofyDatabase.get(activity.applicationContext).dao()
                        if (endpoint.isBlank()) {
                            Toast.makeText(activity, activity.getString(R.string.refresh_site_missing), Toast.LENGTH_SHORT).show()
                        } else {
                            withContext(Dispatchers.IO) {
                                PortalPlaylistClient.sync(
                                    activity.applicationContext,
                                    endpoint,
                                    dao,
                                    PortalPlaylistClient.SyncMode.PULL_ONLY
                                )
                            }
                            Toast.makeText(activity, activity.getString(R.string.refresh_site_success), Toast.LENGTH_SHORT).show()
                            activity.refreshPortalPlaylistsFromLocal()
                        }
                    } catch (cancelled: CancellationException) {
                        throw cancelled
                    } catch (_: Throwable) {
                        Toast.makeText(activity, activity.getString(R.string.refresh_site_failed), Toast.LENGTH_SHORT).show()
                    } finally {
                        isEnabled = true
                        text = activity.getString(R.string.refresh_from_website)
                    }
                }
            }
        }

        val width = when {
            compact -> FrameLayout.LayoutParams.MATCH_PARENT
            tablet -> dp(250)
            else -> dp(236)
        }
        val params = FrameLayout.LayoutParams(width, dp(if (compact) 48 else 50), Gravity.TOP or Gravity.END).apply {
            topMargin = dp(if (compact) 12 else 96)
            marginEnd = dp(if (compact) 16 else if (tablet) 24 else 42)
            if (compact) marginStart = dp(16)
        }
        content.addView(button, params)
    }

    override fun onActivityStarted(activity: Activity) = Unit
    override fun onActivityResumed(activity: Activity) = Unit
    override fun onActivityPaused(activity: Activity) = Unit
    override fun onActivityStopped(activity: Activity) = Unit
    override fun onActivitySaveInstanceState(activity: Activity, outState: Bundle) = Unit
    override fun onActivityDestroyed(activity: Activity) = Unit

    companion object { private const val TAG = "blofy_login_portal_refresh" }
}
