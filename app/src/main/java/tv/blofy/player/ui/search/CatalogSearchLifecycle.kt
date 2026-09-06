package tv.blofy.player.ui.search

import android.app.Activity
import android.app.Application
import android.content.Intent
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.widget.Button
import android.widget.FrameLayout
import tv.blofy.player.core.device.DeviceClass
import tv.blofy.player.ui.browser.ContentBrowserActivity
import tv.blofy.player.ui.catalog.PosterCatalogActivity
import tv.blofy.player.ui.common.BlofyTvDesign

/**
 * Adds one consistent local-search entry point to Live, Movies and Series without changing their
 * paging or playback code. SearchActivity receives the current kind and searches only local Room/FTS.
 */
class CatalogSearchLifecycle : Application.ActivityLifecycleCallbacks {
    override fun onActivityCreated(activity: Activity, savedInstanceState: Bundle?) {
        val kind = when (activity) {
            is ContentBrowserActivity -> activity.intent.getStringExtra(ContentBrowserActivity.EXTRA_KIND)
            is PosterCatalogActivity -> activity.intent.getStringExtra(PosterCatalogActivity.EXTRA_KIND)
            else -> null
        }?.lowercase()?.takeIf { it in SUPPORTED_KINDS } ?: return
        install(activity, kind)
    }

    private fun install(activity: Activity, kind: String) {
        val content = activity.findViewById<FrameLayout>(android.R.id.content) ?: return
        if (content.findViewWithTag<View>(TAG) != null) return
        val density = activity.resources.displayMetrics.density
        fun dp(value: Int) = (value * density).toInt()
        val device = DeviceClass.detect(activity)
        val compact = device == DeviceClass.Kind.PHONE

        val button = Button(activity).apply {
            tag = TAG
            text = "⌕  بحث"
            isAllCaps = false
            textSize = if (compact) 13f else 14.5f
            typeface = BlofyTvDesign.LabelTypeface
            setTextColor(BlofyTvDesign.TextPrimary)
            isFocusable = true
            isFocusableInTouchMode = device == DeviceClass.Kind.TV
            BlofyTvDesign.installTvFocus(this, dp(15).toFloat(), 1.02f, false) {}
            setOnClickListener {
                activity.startActivity(
                    Intent(activity, SearchActivity::class.java)
                        .putExtra(SearchActivity.EXTRA_KIND, kind)
                )
            }
        }

        content.addView(
            button,
            FrameLayout.LayoutParams(dp(if (compact) 112 else 148), dp(if (compact) 44 else 50), Gravity.TOP or Gravity.END).apply {
                topMargin = dp(if (compact) 12 else 18)
                marginEnd = dp(if (compact) 14 else 28)
            }
        )
    }

    override fun onActivityStarted(activity: Activity) = Unit
    override fun onActivityResumed(activity: Activity) = Unit
    override fun onActivityPaused(activity: Activity) = Unit
    override fun onActivityStopped(activity: Activity) = Unit
    override fun onActivitySaveInstanceState(activity: Activity, outState: Bundle) = Unit
    override fun onActivityDestroyed(activity: Activity) = Unit

    companion object {
        private const val TAG = "blofy_catalog_search"
        private val SUPPORTED_KINDS = setOf(
            SearchActivity.KIND_LIVE,
            SearchActivity.KIND_SERIES,
            SearchActivity.KIND_MOVIE
        )
    }
}
