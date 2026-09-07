package tv.blofy.player.ui.home

import android.view.View
import android.view.ViewGroup

/** Updates profile row order only when necessary, preserving current in-screen focus. */
internal object HomeRowReconciler {
    fun apply(parent: ViewGroup, desired: List<View>): Boolean {
        require(desired.toSet().size == desired.size) { "Duplicate Home row" }
        if (parent.childCount == desired.size && desired.indices.all { parent.getChildAt(it) === desired[it] }) return false
        require(desired.all { it.parent == null || it.parent === parent }) { "Home row belongs to another parent" }
        val focused = parent.findFocus()
        val wanted = desired.toSet()
        for (index in parent.childCount - 1 downTo 0) {
            if (parent.getChildAt(index) !in wanted) parent.removeViewAt(index)
        }
        desired.forEachIndexed { index, view ->
            if (parent.getChildAt(index) !== view) {
                if (view.parent === parent) parent.removeView(view)
                parent.addView(view, index)
            }
        }
        // No stored focus across screens/processes: retain only a still-present view in this edit.
        if (focused != null && focused.isShown && focused.isFocusable && isInside(focused, parent)) focused.requestFocus()
        return true
    }

    private fun isInside(view: View, parent: ViewGroup): Boolean {
        var current: View? = view
        while (current != null) {
            if (current === parent) return true
            current = current.parent as? View
        }
        return false
    }
}
