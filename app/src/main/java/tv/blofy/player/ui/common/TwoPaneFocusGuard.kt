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
    private val focusGenerations = WeakHashMap<RecyclerView, Int>()

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

        // Search/top controls are reachable only by an explicit UP from the first visual row.
        // DOWN can never escape a list/grid and jump back to the search bar.
        if (direction == View.FOCUS_UP && position < columns) {
            val top = topTargets[owner]?.get()
            if (top != null && top.isShown && top.isFocusable && top.requestFocus()) return true
            return true
        }

        // Vertical movement is computed by adapter position instead of Android geometry search.
        if (direction == View.FOCUS_DOWN) {
            val next = position + columns
            if (next < count) focusItem(owner, next)
            return true
        }
        if (direction == View.FOCUS_UP) {
            val next = position - columns
            if (next >= 0) focusItem(owner, next)
            return true
        }

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

    /**
     * Explicit focus move with a bounded wait for off-screen binding. While RecyclerView recycles
     * the old focused child we temporarily park focus on the RecyclerView itself, so Android never
     * falls back to an unrelated top/search control. A per-list generation prevents an old delayed
     * request from stealing focus after the user has pressed another direction.
     */
    fun focusItem(list: RecyclerView, position: Int): Boolean {
        val adapter = list.adapter ?: return false
        if (position !in 0 until adapter.itemCount) return false
        val existing = list.findViewHolderForAdapterPosition(position)?.itemView
        if (existing != null) return existing.requestFocus()

        val generation = (focusGenerations[list] ?: 0) + 1
        focusGenerations[list] = generation
        val itemId = if (adapter.hasStableIds()) adapter.getItemId(position) else null
        var listener: RecyclerView.OnChildAttachStateChangeListener? = null

        list.isFocusable = true
        list.isFocusableInTouchMode = true
        list.requestFocus()

        fun stillValid(): Boolean {
            if (!list.isAttachedToWindow || list.adapter !== adapter) return false
            if (focusGenerations[list] != generation) return false
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
