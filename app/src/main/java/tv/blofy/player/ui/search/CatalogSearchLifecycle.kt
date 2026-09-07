package tv.blofy.player.ui.search

import android.app.Activity
import android.app.Application
import android.content.Intent
import android.os.Bundle
import android.view.Gravity
import android.view.KeyEvent
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.FrameLayout
import androidx.recyclerview.widget.RecyclerView
import tv.blofy.player.core.device.DeviceClass
import tv.blofy.player.ui.browser.ContentBrowserActivity
import tv.blofy.player.ui.common.BlofyTvDesign
import tv.blofy.player.ui.common.TwoPaneFocusGuard

/**
 * Adds the floating search entry point only to Live. Movies and Series own a full-width search bar
 * inside PosterCatalogActivity so DPAD navigation stays part of the page hierarchy.
 */
class CatalogSearchLifecycle : Application.ActivityLifecycleCallbacks {
    override fun onActivityResumed(activity: Activity) {
        val kind = kindFor(activity) ?: return
        install(activity, kind)
    }

    private fun kindFor(activity: Activity): String? = when (activity) {
        is ContentBrowserActivity -> activity.intent.getStringExtra(ContentBrowserActivity.EXTRA_KIND)
            ?.ifBlank { SearchActivity.KIND_LIVE } ?: SearchActivity.KIND_LIVE
        else -> null
    }?.lowercase()?.takeIf { it == SearchActivity.KIND_LIVE }

    private fun install(activity: Activity, kind: String) {
        val content = activity.findViewById<FrameLayout>(android.R.id.content) ?: return
        val existing = content.findViewWithTag<Button>(TAG)
        val button = existing ?: createButton(activity, kind).also { created ->
            val density = activity.resources.displayMetrics.density
            fun dp(value: Int) = (value * density).toInt()
            val compact = DeviceClass.detect(activity) == DeviceClass.Kind.PHONE
            content.addView(
                created,
                FrameLayout.LayoutParams(
                    dp(if (compact) 112 else 148),
                    dp(if (compact) 44 else 50),
                    Gravity.TOP or Gravity.END
                ).apply {
                    topMargin = dp(if (compact) 12 else 18)
                    marginEnd = dp(if (compact) 14 else 28)
                }
            )
        }

        if (DeviceClass.detect(activity) == DeviceClass.Kind.TV) {
            TwoPaneFocusGuard.registerTopTarget(content, button)
            button.setOnKeyListener { _, keyCode, event ->
                if (event.action == KeyEvent.ACTION_DOWN && keyCode == KeyEvent.KEYCODE_DPAD_DOWN) {
                    focusPrimaryContent(content)
                } else {
                    false
                }
            }
        }
    }

    private fun createButton(activity: Activity, kind: String): Button {
        val density = activity.resources.displayMetrics.density
        fun dp(value: Int) = (value * density).toInt()
        val device = DeviceClass.detect(activity)
        val compact = device == DeviceClass.Kind.PHONE
        return Button(activity).apply {
            id = View.generateViewId()
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
    }

    private fun focusPrimaryContent(content: View): Boolean {
        val recyclers = ArrayList<RecyclerView>()
        collectRecyclers(content, recyclers)
        val target = recyclers
            .filter { it.isShown && (it.adapter?.itemCount ?: 0) > 0 }
            .maxByOrNull { it.width }
            ?: return false
        return TwoPaneFocusGuard.focusItem(target, 0)
    }

    private fun collectRecyclers(view: View, out: MutableList<RecyclerView>) {
        if (view is RecyclerView) {
            out += view
            return
        }
        if (view is ViewGroup) for (index in 0 until view.childCount) collectRecyclers(view.getChildAt(index), out)
    }

    override fun onActivityCreated(activity: Activity, savedInstanceState: Bundle?) = Unit
    override fun onActivityStarted(activity: Activity) = Unit
    override fun onActivityPaused(activity: Activity) = Unit
    override fun onActivityStopped(activity: Activity) = Unit
    override fun onActivitySaveInstanceState(activity: Activity, outState: Bundle) = Unit
    override fun onActivityDestroyed(activity: Activity) = Unit

    companion object {
        private const val TAG = "blofy_catalog_search"
    }
}
