package tv.blofy.player.ui.common

import android.graphics.Rect
import android.view.KeyEvent
import android.view.View
import android.view.ViewGroup
import androidx.recyclerview.widget.GridLayoutManager
import androidx.recyclerview.widget.RecyclerView
import java.lang.ref.WeakReference
import java.util.WeakHashMap

/** Explicit DPAD zones. No focus position is persisted across screens or app launches. */
object TwoPaneFocusGuard {
    private val topTargets = WeakHashMap<RecyclerView, WeakReference<View>>()

    fun registerTopTarget(root: View, target: View) {
        val recyclers = ArrayList<RecyclerView>()
        collectRecyclers(root, recyclers)
        recyclers.forEach { topTargets[it] = WeakReference(target) }
    }

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
            else -> return false
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
        if (position !in 0 until count) return true
        val grid = owner.layoutManager as? GridLayoutManager
        val columns = grid?.spanCount ?: 1
        val rtl = owner.layoutDirection == View.LAYOUT_DIRECTION_RTL

        if (direction == View.FOCUS_UP && position < columns) {
            val top = topTargets[owner]?.get()
            if (top != null && top.isShown && top.isFocusable && top.requestFocus()) return true
        }

        // Product choice: entering content starts at the first item; no previous poster bookmark.
        if (owner === categories && direction == View.FOCUS_RIGHT) {
            focusContent()
            return true
        }
        if (owner === content && direction == View.FOCUS_LEFT &&
            isLeftEdge(position, count, columns, rtl)) {
            focusCategories()
            return true
        }
        if (grid != null && (direction == View.FOCUS_LEFT || direction == View.FOCUS_RIGHT)) {
            val next = horizontalNeighbor(position, count, columns, direction == View.FOCUS_LEFT, rtl)
            if (next != null) focusItem(owner, next)
            return true
        }

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

    /** Explicit cross-pane request with a bounded wait for slow off-screen binding. */
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

        fun tryFocus(): Boolean {
            if (!stillValid()) return false
            val target = list.findViewHolderForAdapterPosition(position)?.itemView ?: return false
            return target.requestFocus().also { moved ->
                if (moved) target.requestRectangleOnScreen(Rect(0, 0, target.width, target.height), true)
            }
        }

        listener = object : RecyclerView.OnChildAttachStateChangeListener {
            override fun onChildViewAttachedToWindow(view: View) {
                if (!stillValid()) {
                    listener?.let(list::removeOnChildAttachStateChangeListener)
                    listener = null
                    return
                }
                if (list.getChildViewHolder(view).bindingAdapterPosition == position && tryFocus()) {
                    listener?.let(list::removeOnChildAttachStateChangeListener)
                    listener = null
                }
            }
            override fun onChildViewDetachedFromWindow(view: View) = Unit
        }
        list.addOnChildAttachStateChangeListener(listener!!)
        list.scrollToPosition(position)
        list.post {
            if (tryFocus() || !stillValid()) {
                listener?.let(list::removeOnChildAttachStateChangeListener)
                listener = null
            }
        }
        list.postDelayed({
            listener?.let(list::removeOnChildAttachStateChangeListener)
            listener = null
        }, FOCUS_REQUEST_TIMEOUT_MS)
        return true
    }

    private fun collectRecyclers(view: View, out: MutableList<RecyclerView>) {
        if (view is RecyclerView) {
            out += view
            return
        }
        if (view is ViewGroup) for (index in 0 until view.childCount) collectRecyclers(view.getChildAt(index), out)
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
