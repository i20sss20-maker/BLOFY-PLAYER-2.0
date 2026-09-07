package tv.blofy.player.ui.profile

import android.view.View
import android.view.ViewGroup
import android.view.ViewTreeObserver
import android.widget.TextView
import tv.blofy.player.R
import tv.blofy.player.core.profile.KidsPolicy

/** Rechecks asynchronously added cards; only restores properties changed by this filter. */
internal class KidsHomeFilter(private val root: View, private val isKids: () -> Boolean) {
    private data class HiddenState(val visibility: Int, val focusable: Boolean, val touchFocusable: Boolean)
    private val listener = ViewTreeObserver.OnGlobalLayoutListener { refresh() }
    private val observer = root.viewTreeObserver
    private var attached = false

    fun attach() {
        if (attached) return
        attached = true
        observer.addOnGlobalLayoutListener(listener)
        refresh()
    }

    fun detach() {
        attached = false
        if (observer.isAlive) observer.removeOnGlobalLayoutListener(listener)
        if (root.viewTreeObserver.isAlive && root.viewTreeObserver !== observer) {
            root.viewTreeObserver.removeOnGlobalLayoutListener(listener)
        }
    }

    private fun refresh() {
        if (attached) filter(root, isKids())
    }

    private fun filter(view: View, kids: Boolean) {
        if (view !is ViewGroup) return
        for (index in 0 until view.childCount) {
            val child = view.getChildAt(index)
            if (child !is ViewGroup) continue
            val previous = child.getTag(R.id.blofy_kids_hidden_state) as? HiddenState
            val blocked = kids && ((child.isFocusable && child.isClickable) || previous != null) &&
                KidsPolicy.isBlocked(visibleText(child), null, null)
            if (previous != null && !blocked) {
                child.visibility = previous.visibility
                child.isFocusableInTouchMode = previous.touchFocusable
                child.isFocusable = previous.focusable
                child.setTag(R.id.blofy_kids_hidden_state, null)
            }
            if (blocked) {
                if (previous == null && child.visibility == View.VISIBLE) {
                    child.setTag(R.id.blofy_kids_hidden_state, HiddenState(child.visibility, child.isFocusable, child.isFocusableInTouchMode))
                }
                if (previous != null || child.getTag(R.id.blofy_kids_hidden_state) != null) {
                    child.visibility = View.GONE
                    child.isFocusable = false
                }
                continue
            }
            filter(child, kids)
        }
    }

    private fun visibleText(view: View): String {
        if (view is TextView) return view.text?.toString().orEmpty()
        if (view !is ViewGroup) return ""
        return (0 until view.childCount).map { visibleText(view.getChildAt(it)).trim() }
            .filter(String::isNotBlank).joinToString(" ").take(600)
    }
}
