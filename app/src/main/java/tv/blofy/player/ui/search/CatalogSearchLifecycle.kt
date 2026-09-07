package tv.blofy.player.ui.search

import android.app.Activity
import android.app.Application
import android.content.Intent
import android.os.Bundle
import android.view.Gravity
import android.view.KeyEvent
import android.view.View
import android.view.ViewGroup
import android.view.Window
import android.widget.Button
import android.widget.FrameLayout
import androidx.recyclerview.widget.GridLayoutManager
import androidx.recyclerview.widget.RecyclerView
import tv.blofy.player.core.device.DeviceClass
import tv.blofy.player.ui.browser.ContentBrowserActivity
import tv.blofy.player.ui.catalog.PosterCatalogActivity
import tv.blofy.player.ui.common.BlofyTvDesign

/**
 * Adds one consistent local-search entry point to Live, Movies and Series without changing their
 * paging or playback code. SearchActivity receives the current kind and searches only local Room/FTS.
 *
 * The control is installed from onActivityResumed, after the target Activity has finished its own
 * setContentView() work. Installing from onActivityCreated could attach the button to a temporary
 * content root which was replaced later, making search appear to be missing on real devices.
 */
class CatalogSearchLifecycle : Application.ActivityLifecycleCallbacks {
    override fun onActivityResumed(activity: Activity) {
        val kind = kindFor(activity) ?: return
        install(activity, kind)
    }

    private fun kindFor(activity: Activity): String? = when (activity) {
        is ContentBrowserActivity -> activity.intent.getStringExtra(ContentBrowserActivity.EXTRA_KIND)
            ?.ifBlank { SearchActivity.KIND_LIVE } ?: SearchActivity.KIND_LIVE
        is PosterCatalogActivity -> activity.intent.getStringExtra(PosterCatalogActivity.EXTRA_KIND)
            ?.ifBlank { SearchActivity.KIND_MOVIE } ?: SearchActivity.KIND_MOVIE
        else -> null
    }?.lowercase()?.takeIf { it in SUPPORTED_KINDS }

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

        // Give TV remotes a deterministic path to/from search. The screen-specific focus guard can
        // keep owning normal list navigation; this wrapper only handles the top-edge handoff.
        if (DeviceClass.detect(activity) == DeviceClass.Kind.TV) {
            val current = activity.window.callback ?: return
            if (current !is SearchFocusCallback) {
                activity.window.callback = SearchFocusCallback(content, button, current)
            } else {
                current.update(content, button)
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

    private class SearchFocusCallback(
        private var content: FrameLayout,
        private var search: Button,
        private val original: Window.Callback,
    ) : Window.Callback by original {
        fun update(newContent: FrameLayout, newSearch: Button) {
            content = newContent
            search = newSearch
        }

        override fun dispatchKeyEvent(event: KeyEvent): Boolean {
            if (event.action == KeyEvent.ACTION_DOWN && event.repeatCount == 0) {
                when (event.keyCode) {
                    KeyEvent.KEYCODE_DPAD_UP -> if (moveFromTopEdgeToSearch()) return true
                    KeyEvent.KEYCODE_DPAD_DOWN -> if (moveFromSearchToContent()) return true
                }
            }
            return original.dispatchKeyEvent(event)
        }

        private fun moveFromTopEdgeToSearch(): Boolean {
            if (!search.isShown || !search.isFocusable || search.hasFocus()) return false
            val focused = content.rootView.findFocus() ?: return false
            val recycler = ancestorRecycler(focused) ?: return false
            val holder = recycler.findContainingViewHolder(focused) ?: return false
            val position = holder.bindingAdapterPosition
            if (position == RecyclerView.NO_POSITION) return false
            val columns = (recycler.layoutManager as? GridLayoutManager)?.spanCount ?: 1
            if (position >= columns) return false
            return search.requestFocus()
        }

        private fun moveFromSearchToContent(): Boolean {
            if (!search.hasFocus()) return false
            val recyclers = ArrayList<RecyclerView>()
            collectRecyclers(content, recyclers)
            val target = recyclers
                .filter { it.isShown && (it.adapter?.itemCount ?: 0) > 0 }
                .maxByOrNull { it.width }
                ?: return false
            val first = target.findViewHolderForAdapterPosition(0)?.itemView
            if (first != null) return first.requestFocus()
            target.scrollToPosition(0)
            target.post { target.findViewHolderForAdapterPosition(0)?.itemView?.requestFocus() }
            return true
        }

        private fun ancestorRecycler(view: View): RecyclerView? {
            var cursor: View? = view
            while (cursor != null) {
                if (cursor is RecyclerView) return cursor
                cursor = cursor.parent as? View
            }
            return null
        }

        private fun collectRecyclers(view: View, out: MutableList<RecyclerView>) {
            if (view is RecyclerView) {
                out += view
                return
            }
            if (view is ViewGroup) for (index in 0 until view.childCount) {
                collectRecyclers(view.getChildAt(index), out)
            }
        }
    }

    override fun onActivityCreated(activity: Activity, savedInstanceState: Bundle?) = Unit
    override fun onActivityStarted(activity: Activity) = Unit
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
