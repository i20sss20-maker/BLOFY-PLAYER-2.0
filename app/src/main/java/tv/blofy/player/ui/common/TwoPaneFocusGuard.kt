package tv.blofy.player.ui.common

import android.graphics.Rect
import android.view.KeyEvent
import android.view.View
import androidx.recyclerview.widget.GridLayoutManager
import androidx.recyclerview.widget.RecyclerView

/** Explicit DPAD zones. No focus position is persisted across screens or app launches. */
object TwoPaneFocusGuard {
    fun handle(
        event: KeyEvent,
        categories: RecyclerView,
        content: RecyclerView,
        focusCategories: () -> Boolean,
        focusContent: () -> Boolean,
    ): Boolean {
        if (event.action != KeyEvent.ACTION_DOWN) return false
        val direction = when (event.keyCode) {
            KeyEvent.KEYCODE_DPAD_UP -> View.FOCUS_UP
            KeyEvent.KEYCODE_DPAD_DOWN -> View.FOCUS_DOWN
            KeyEvent.KEYCODE_DPAD_LEFT -> View.FOCUS_LEFT
            KeyEvent.KEYCODE_DPAD_RIGHT -> View.FOCUS_RIGHT
            else -> return false // OK, long-press, Back, touch and playback controls are untouched.
        }
        val owner = when {
            categories.hasFocus() -> categories
            content.hasFocus() -> content
            else -> return false
        }
        val focused = owner.findFocus() ?: return false
        val position = owner.findContainingViewHolder(focused)?.bindingAdapterPosition
            ?: RecyclerView.NO_POSITION
        val count = owner.adapter?.itemCount ?: 0
        if (position !in 0 until count) return true // A diff/layout must not send focus to the other pane.
        val grid = owner.layoutManager as? GridLayoutManager
        val columns = grid?.spanCount ?: 1
        val rtl = owner.layoutDirection == View.LAYOUT_DIRECTION_RTL

        // These screens place categories physically to the left, independent of text language.
        if (owner === categories && direction == View.FOCUS_RIGHT) {
            focusContent()
            return true // Even an empty/loading destination must not fall through to global search.
        }
        if (owner === content && direction == View.FOCUS_LEFT &&
            isLeftEdge(position, count, columns, rtl)) {
            focusCategories()
            return true
        }
        if (grid != null && (direction == View.FOCUS_LEFT || direction == View.FOCUS_RIGHT)) {
            val next = horizontalNeighbor(position, count, columns, direction == View.FOCUS_LEFT, rtl)
            if (next != null) focusItem(owner, next)
            return true // Do not wrap to another row or skip to a different pane.
        }

        // RecyclerView still lays out off-screen rows in focusSearch. Only its global fallback
        // is rejected, so long lists keep scrolling while their top/bottom edges remain isolated.
        val candidate = owner.focusSearch(focused, direction)
        if (candidate != null && candidate !== focused && candidate !== owner &&
            contains(owner, candidate) && candidate.isFocusable) {
            candidate.requestFocus(direction)
            candidate.requestRectangleOnScreen(Rect(0, 0, candidate.width, candidate.height), false)
        }
        return true
    }

    internal fun isLeftEdge(index: Int, count: Int, columns: Int, rtl: Boolean): Boolean {
        if (columns <= 0 || index !in 0 until count) return false
        return if (rtl) index % columns == columns - 1 || index == count - 1 else index % columns == 0
    }

    internal fun horizontalNeighbor(index: Int, count: Int, columns: Int, left: Boolean, rtl: Boolean): Int? {
        if (columns <= 0 || index !in 0 until count) return null
        val next = index + if (left == rtl) 1 else -1
        return next.takeIf { it in 0 until count && it / columns == index / columns }
    }

    /**
     * Explicit cross-pane request. When the target row is off-screen, keep a short-lived attach
     * listener instead of relying on one posted lookup. Slow TV boxes can bind the requested row
     * several frames after scrollToPosition(); the old one-shot lookup could therefore consume a
     * DPAD press without ever moving focus.
     *
     * The request is invalidated as soon as the user moves focus elsewhere, the adapter changes,
     * or the stable id at the requested position changes.
     */
    fun focusItem(list: RecyclerView, position: Int): Boolean {
        val adapter = list.adapter ?: return false
        if (position !in 0 until adapter.itemCount) return false
        val existing = list.findViewHolderForAdapterPosition(position)?.itemView
        if (existing != null) return existing.requestFocus()

        val origin = list.rootView.findFocus()
        val itemId = if (adapter.hasStableIds()) adapter.getItemId(position) else null
        var listener: RecyclerView.OnChildAttachStateChangeListener? = null

        fun stillValid(): Boolean {
            if (!list.isAttachedToWindow || list.adapter !== adapter) return false
            if (list.rootView.findFocus() !== origin) return false
            if (position !in 0 until adapter.itemCount) return false
            if (itemId != null && adapter.getItemId(position) != itemId) return false
            return true
        }

        fun tryFocusTarget(): Boolean {
            if (!stillValid()) return false
            val target = list.findViewHolderForAdapterPosition(position)?.itemView ?: return false
            return target.requestFocus().also { focused ->
                if (focused) target.requestRectangleOnScreen(
                    Rect(0, 0, target.width, target.height),
                    true
                )
            }
        }

        listener = object : RecyclerView.OnChildAttachStateChangeListener {
            override fun onChildViewAttachedToWindow(view: View) {
                if (!stillValid()) {
                    listener?.let(list::removeOnChildAttachStateChangeListener)
                    listener = null
                    return
                }
                val holder = list.getChildViewHolder(view)
                if (holder.bindingAdapterPosition != position) return
                if (tryFocusTarget()) {
                    listener?.let(list::removeOnChildAttachStateChangeListener)
                    listener = null
                }
            }

            override fun onChildViewDetachedFromWindow(view: View) = Unit
        }
        list.addOnChildAttachStateChangeListener(listener!!)
        list.scrollToPosition(position)
        list.post {
            if (tryFocusTarget()) {
                listener?.let(list::removeOnChildAttachStateChangeListener)
                listener = null
            } else if (!stillValid()) {
                listener?.let(list::removeOnChildAttachStateChangeListener)
                listener = null
            }
        }
        // Safety cleanup: never keep a stale listener around if this RecyclerView does not attach
        // the row because the screen is paused/destroyed or its layout is replaced.
        list.postDelayed({
            listener?.let(list::removeOnChildAttachStateChangeListener)
            listener = null
        }, FOCUS_REQUEST_TIMEOUT_MS)
        return true
    }

    private fun contains(parent: View, child: View): Boolean {
        var current: View? = child
        while (current != null) {
            if (current === parent) return true
            current = current.parent as? View
        }
        return false
    }

    private const val FOCUS_REQUEST_TIMEOUT_MS = 700L
}
