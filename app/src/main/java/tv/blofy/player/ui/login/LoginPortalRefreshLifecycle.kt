package tv.blofy.player.ui.login

import android.app.Activity
import android.app.Application
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.widget.Button
import android.widget.FrameLayout
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import tv.blofy.player.BuildConfig
import tv.blofy.player.core.identity.PortalPlaylistClient
import tv.blofy.player.data.local.BlofyDatabase
import tv.blofy.player.ui.common.BlofyTvDesign
import tv.blofy.player.ui.common.TvUiTuning

/** Adds an explicit pull-only website refresh button to the root login screen. */
class LoginPortalRefreshLifecycle : Application.ActivityLifecycleCallbacks {
    override fun onActivityCreated(activity: Activity, savedInstanceState: Bundle?) {
        if (activity is LoginActivity) install(activity)
    }

    private fun install(activity: AppCompatActivity) {
        val content = activity.findViewById<FrameLayout>(android.R.id.content) ?: return
        if (content.findViewWithTag<View>(TAG) != null) return
        val density = activity.resources.displayMetrics.density
        fun dp(value: Int) = (value * density).toInt()

        val button = Button(activity).apply {
            tag = TAG
            text = "↻  تحديث من الموقع"
            isAllCaps = false
            isFocusable = true
            isFocusableInTouchMode = true
            typeface = BlofyTvDesign.BodyTypeface
            setTextColor(BlofyTvDesign.TextPrimary)
            background = BlofyTvDesign.elevatedSurface(dp(16).toFloat())
            BlofyTvDesign.installTvFocus(this, dp(16).toFloat(), 1.03f, false) {}
            setOnClickListener {
                if (!isEnabled) return@setOnClickListener
                lifecycleScope.launch {
                    isEnabled = false
                    text = "جاري التحديث…"
                    try {
                        val endpoint = BuildConfig.ACTIVATION_BASE_URL.trim()
                        val dao = BlofyDatabase.get(activity.applicationContext).dao()
                        if (endpoint.isBlank()) {
                            Toast.makeText(activity, "رابط BLOFY غير متاح", Toast.LENGTH_SHORT).show()
                        } else {
                            withContext(Dispatchers.IO) {
                                PortalPlaylistClient.sync(
                                    activity.applicationContext,
                                    endpoint,
                                    dao,
                                    PortalPlaylistClient.SyncMode.PULL_ONLY
                                )
                            }
                            Toast.makeText(activity, "تم تحديث القوائم من الموقع", Toast.LENGTH_SHORT).show()
                            activity.recreate()
                        }
                    } catch (cancelled: CancellationException) {
                        throw cancelled
                    } catch (_: Throwable) {
                        Toast.makeText(activity, "تعذر تحديث القوائم • حاول مرة أخرى", Toast.LENGTH_SHORT).show()
                    } finally {
                        isEnabled = true
                        text = "↻  تحديث من الموقع"
                    }
                }
            }
        }

        val params = FrameLayout.LayoutParams(dp(236), dp(50), Gravity.TOP or Gravity.END).apply {
            topMargin = dp(96)
            marginEnd = dp(42)
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
