package tv.blofy.player.ui.common

import android.graphics.Rect
import android.view.KeyEvent
import android.view.View
import android.view.ViewGroup
import androidx.recyclerview.widget.GridLayoutManager
import androidx.recyclerview.widget.RecyclerView
import java.lang.ref.WeakReference
import java.util.WeakHashMap

/** Explicit, deterministic DPAD zones for TV lists. */
object TwoPaneFocusGuard {
    private val topTargets = WeakHashMap<RecyclerView, WeakReference<View>>()
    private val focusGenerations = WeakHashMap<RecyclerView, Int>()
    private val logicalPositions = WeakHashMap<RecyclerView, Int>()
    private val pendingPositions = WeakHashMap<RecyclerView, Int>()
    private val pendingCleanups = WeakHashMap<RecyclerView, () -> Unit>()
    private data class PendingClick(
        val position: Int,
        val adapter: WeakReference<RecyclerView.Adapter<*>>,
        val itemId: Long?,
        var released: Boolean = false,
    )
    private val pendingClicks = WeakHashMap<RecyclerView, PendingClick>()
    private val consumedConfirmKeys = WeakHashMap<RecyclerView, Int>()

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
        if (event.keyCode == KeyEvent.KEYCODE_DPAD_CENTER || event.keyCode == KeyEvent.KEYCODE_ENTER ||
            event.keyCode == KeyEvent.KEYCODE_NUMPAD_ENTER) {
            val lists = listOf(categories, content)
            val captured = lists.firstOrNull { consumedConfirmKeys[it] == event.keyCode }
            if (captured != null) {
                if (event.action == KeyEvent.ACTION_UP) {
                    consumedConfirmKeys.remove(captured)
                    if (event.isCanceled || !captured.hasFocus()) pendingClicks.remove(captured)
                    else {
                        pendingClicks[captured]?.released = true
                        deliverPendingClick(captured)
                    }
                }
                return true
            }
            val owner = lists.firstOrNull { it.hasFocus() }
            val position = owner?.let { pendingPositions[it] }
            if (event.action == KeyEvent.ACTION_DOWN && owner != null && position != null) {
                val adapter = owner.adapter ?: return true
                if (position !in 0 until adapter.itemCount) return true
                consumedConfirmKeys[owner] = event.keyCode
                pendingClicks[owner] = PendingClick(position, WeakReference(adapter), if (adapter.hasStableIds()) adapter.getItemId(position) else null)
                return true
            }
            return false
        }
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
        val focused = owner.findFocus()
        val adapter = owner.adapter ?: return true
        val count = adapter.itemCount
        if (count <= 0) return true

        // Keep a logical position while the requested row is being attached, so held/repeated
        // DPAD presses continue from that row instead of escaping to Search/the first item.
        val holderPosition = focused?.takeIf { it !== owner }
            ?.let(owner::findContainingViewHolder)
            ?.bindingAdapterPosition
            ?.takeIf { it in 0 until count }
        val position = pendingPositions[owner]?.takeIf { it in 0 until count }
            ?: holderPosition ?: logicalPositions[owner]?.takeIf { it in 0 until count }
            ?: firstVisiblePosition(owner).takeIf { it in 0 until count }
            ?: 0
        logicalPositions[owner] = position

        val grid = owner.layoutManager as? GridLayoutManager
        val columns = grid?.spanCount ?: 1
        val rtl = owner.layoutDirection == View.LAYOUT_DIRECTION_RTL

        if (direction == View.FOCUS_UP && position < columns) {
            val top = topTargets[owner]?.get()
            if (top != null && top.isShown && top.isFocusable && top.requestFocus()) {
                cancelPending(owner)
            }
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

        // Browser zones are physical: categories are on the left, content is on the right.
        // Never let Android's generic focusSearch guess a different zone.
        if (owner === categories) {
            if (direction == View.FOCUS_RIGHT && focusContent()) cancelPending(owner)
            return true
        }
        if (owner === content && grid == null) {
            if (direction == View.FOCUS_LEFT && focusCategories()) cancelPending(owner)
            return true
        }
        if (owner === content && direction == View.FOCUS_LEFT &&
            isLeftEdge(position, count, columns, rtl)) {
            if (focusCategories()) cancelPending(owner)
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
        val hadPendingMove = pendingPositions.containsKey(list)
        cancelPending(list)
        val generation = (focusGenerations[list] ?: 0) + 1
        focusGenerations[list] = generation
        logicalPositions[list] = position
        val existing = list.findViewHolderForAdapterPosition(position)?.itemView
        if (existing != null && existing.isShown) {
            // A previous scrollToPosition may still be waiting for layout even though this newer
            // target is attached. Replace that scroll too, not just its focus callback.
            if (hadPendingMove) list.scrollToPosition(position)
            if (existing.requestFocus()) {
                existing.requestRectangleOnScreen(Rect(0, 0, existing.width, existing.height), true)
                return true
            }
        }

        val itemId = if (adapter.hasStableIds()) adapter.getItemId(position) else null
        pendingPositions[list] = position
        // Retain the visible row while scrolling. Only park when entering from another pane.
        if (!list.hasFocus()) parkFocus(list)
        var listener: RecyclerView.OnChildAttachStateChangeListener? = null
        var attempt: Runnable? = null
        var timeout: Runnable? = null

        fun cleanup() {
            listener?.let(list::removeOnChildAttachStateChangeListener)
            listener = null
            attempt?.let(list::removeCallbacks)
            timeout?.let(list::removeCallbacks)
            if (focusGenerations[list] == generation) {
                pendingPositions.remove(list)
                pendingCleanups.remove(list)
            }
        }

        fun stillValid(): Boolean {
            if (!list.isAttachedToWindow || list.adapter !== adapter) return false
            if (focusGenerations[list] != generation) return false
            if (position !in 0 until adapter.itemCount) return false
            if (logicalPositions[list] != position) return false
            if (itemId != null && adapter.getItemId(position) != itemId) return false
            val currentFocus = list.rootView.findFocus()
            return currentFocus == null || currentFocus === list || contains(list, currentFocus)
        }

        fun tryFocus(): Boolean {
            if (!stillValid() || list.isComputingLayout) return false
            val target = list.findViewHolderForAdapterPosition(position)?.itemView ?: return false
            return target.requestFocus().also { moved ->
                if (moved) {
                    target.requestRectangleOnScreen(Rect(0, 0, target.width, target.height), true)
                    deliverPendingClick(list)
                }
            }
        }

        attempt = Runnable {
            if (!stillValid()) { pendingClicks.remove(list); cleanup() }
            else if (tryFocus()) cleanup()
        }
        listener = object : RecyclerView.OnChildAttachStateChangeListener {
            override fun onChildViewAttachedToWindow(view: View) {
                if (!stillValid()) {
                    cleanup()
                } else {
                    // Attachment can happen in the middle of RecyclerView's layout. Focus only
                    // after binding/layout, when bindingAdapterPosition is trustworthy.
                    attempt?.let { list.removeCallbacks(it); list.post(it) }
                }
            }
            override fun onChildViewDetachedFromWindow(view: View) = Unit
        }
        timeout = Runnable {
            if (!stillValid() || !tryFocus()) pendingClicks.remove(list)
            cleanup()
        }
        pendingCleanups[list] = ::cleanup
        list.addOnChildAttachStateChangeListener(checkNotNull(listener))
        list.scrollToPosition(position)
        list.post(checkNotNull(attempt))
        list.postDelayed(checkNotNull(timeout), FOCUS_REQUEST_TIMEOUT_MS)
        return true
    }

    private fun cancelPending(list: RecyclerView) {
        pendingCleanups.remove(list)?.invoke()
        pendingPositions.remove(list)
        pendingClicks.remove(list)
    }

    private fun deliverPendingClick(list: RecyclerView) {
        val click = pendingClicks[list] ?: return
        if (!click.released) return
        val adapter = click.adapter.get()
        if (adapter == null || list.adapter !== adapter || click.position !in 0 until adapter.itemCount ||
            (click.itemId != null && adapter.getItemId(click.position) != click.itemId)) {
            pendingClicks.remove(list)
            return
        }
        val target = list.findViewHolderForAdapterPosition(click.position)?.itemView ?: return
        if (!target.hasFocus()) return
        pendingClicks.remove(list)
        target.performClick()
    }

    private fun parkFocus(list: RecyclerView) {
        list.isFocusable = true
        list.isFocusableInTouchMode = true
        val previous = list.descendantFocusability
        // requestFocus() with FOCUS_AFTER_DESCENDANTS focuses the FIRST visible child, not the
        // RecyclerView. That was the reproducible jump-to-top at an off-screen row boundary.
        list.descendantFocusability = ViewGroup.FOCUS_BLOCK_DESCENDANTS
        try { list.requestFocus() } finally { list.descendantFocusability = previous }
    }

    private fun firstVisiblePosition(list: RecyclerView): Int = when (val lm = list.layoutManager) {
        is androidx.recyclerview.widget.LinearLayoutManager -> lm.findFirstVisibleItemPosition()
        else -> RecyclerView.NO_POSITION
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

    private const val FOCUS_REQUEST_TIMEOUT_MS = 550L
}
