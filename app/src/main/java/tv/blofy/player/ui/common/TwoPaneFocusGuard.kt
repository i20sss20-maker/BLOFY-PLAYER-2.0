package tv.blofy.player.ui.common

import android.graphics.Rect
import android.view.KeyEvent
import android.view.View
import android.view.ViewGroup
import androidx.recyclerview.widget.GridLayoutManager
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import java.lang.ref.WeakReference
import java.util.WeakHashMap

/**
 * One deterministic DPAD owner for two-pane TV browsers.
 *
 * Android focusSearch is intentionally not used between list children. Large IPTV lists recycle
 * views while a key is held, and generic focus search can then escape to Search/header controls.
 * We keep a logical adapter position and move exactly one row/column per accepted DPAD event.
 */
object TwoPaneFocusGuard {
    private val topTargets = WeakHashMap<RecyclerView, WeakReference<View>>()
    private val focusGenerations = WeakHashMap<RecyclerView, Int>()
    private val logicalPositions = WeakHashMap<RecyclerView, Int>()

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
        val adapter = owner.adapter ?: return true
        val count = adapter.itemCount
        if (count <= 0) return true

        val focused = owner.findFocus()
        val holderPosition = focused?.takeIf { it !== owner }
            ?.let(owner::findContainingViewHolder)
            ?.bindingAdapterPosition
            ?.takeIf { it in 0 until count }
        val position = holderPosition
            ?: logicalPositions[owner]?.takeIf { it in 0 until count }
            ?: firstVisiblePosition(owner).takeIf { it in 0 until count }
            ?: 0
        logicalPositions[owner] = position

        val grid = owner.layoutManager as? GridLayoutManager
        val columns = grid?.spanCount ?: 1
        val rtl = owner.layoutDirection == View.LAYOUT_DIRECTION_RTL

        // Search/header is reachable only by a deliberate UP from the first logical row.
        if (direction == View.FOCUS_UP && position < columns) {
            val top = topTargets[owner]?.get()
            if (top != null && top.isShown && top.isFocusable) top.requestFocus()
            return true
        }

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

        // Physical TV zones: category rail is left, content is right. Locale/RTL must not invert it.
        if (owner === categories) {
            if (direction == View.FOCUS_RIGHT) focusContent()
            return true
        }
        if (owner === content && grid == null) {
            if (direction == View.FOCUS_LEFT) focusCategories()
            return true
        }
        if (owner === content && direction == View.FOCUS_LEFT && isLeftEdge(position, count, columns, rtl)) {
            focusCategories()
            return true
        }
        if (grid != null && (direction == View.FOCUS_LEFT || direction == View.FOCUS_RIGHT)) {
            val next = horizontalNeighbor(position, count, columns, direction == View.FOCUS_LEFT, rtl)
            if (next != null) focusItem(owner, next)
            return true
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

    fun focusItem(list: RecyclerView, position: Int): Boolean {
        val adapter = list.adapter ?: return false
        if (position !in 0 until adapter.itemCount) return false
        logicalPositions[list] = position

        list.findViewHolderForAdapterPosition(position)?.itemView?.takeIf { it.isShown }?.let { target ->
            return target.requestFocus().also { moved ->
                if (moved) target.requestRectangleOnScreen(Rect(0, 0, target.width, target.height), false)
            }
        }

        val generation = (focusGenerations[list] ?: 0) + 1
        focusGenerations[list] = generation
        val itemId = if (adapter.hasStableIds()) adapter.getItemId(position) else null
        var listener: RecyclerView.OnChildAttachStateChangeListener? = null

        // Keep ownership inside this RecyclerView while the requested off-screen child is attached.
        list.isFocusable = true
        list.isFocusableInTouchMode = true
        list.requestFocus()

        fun stillValid(): Boolean {
            if (!list.isAttachedToWindow || list.adapter !== adapter) return false
            if (focusGenerations[list] != generation || logicalPositions[list] != position) return false
            if (position !in 0 until adapter.itemCount) return false
            if (itemId != null && adapter.getItemId(position) != itemId) return false
            val current = list.rootView.findFocus()
            return current == null || current === list || contains(list, current)
        }

        fun tryFocus(): Boolean {
            if (!stillValid()) return false
            val target = list.findViewHolderForAdapterPosition(position)?.itemView ?: return false
            if (!target.isShown) return false
            return target.requestFocus().also { moved ->
                if (moved) target.requestRectangleOnScreen(Rect(0, 0, target.width, target.height), false)
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
        scrollIntoView(list, position)
        list.postOnAnimation {
            if (tryFocus() || !stillValid()) {
                listener?.let(list::removeOnChildAttachStateChangeListener)
                listener = null
            }
        }
        list.postDelayed({
            if (stillValid()) tryFocus()
            listener?.let(list::removeOnChildAttachStateChangeListener)
            listener = null
        }, FOCUS_REQUEST_TIMEOUT_MS)
        return true
    }

    private fun scrollIntoView(list: RecyclerView, position: Int) {
        val lm = list.layoutManager as? LinearLayoutManager ?: run {
            list.scrollToPosition(position)
            return
        }
        val first = lm.findFirstVisibleItemPosition()
        val last = lm.findLastVisibleItemPosition()
        if (first != RecyclerView.NO_POSITION && last != RecyclerView.NO_POSITION && position in first..last) return
        val childHeight = list.getChildAt(0)?.height?.takeIf { it > 0 } ?: 1
        val offset = when {
            last != RecyclerView.NO_POSITION && position > last -> (list.height - childHeight * 2).coerceAtLeast(0)
            else -> childHeight.coerceAtLeast(0)
        }
        lm.scrollToPositionWithOffset(position, offset)
    }

    private fun firstVisiblePosition(list: RecyclerView): Int =
        (list.layoutManager as? LinearLayoutManager)?.findFirstVisibleItemPosition() ?: RecyclerView.NO_POSITION

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

    private const val FOCUS_REQUEST_TIMEOUT_MS = 220L
}
