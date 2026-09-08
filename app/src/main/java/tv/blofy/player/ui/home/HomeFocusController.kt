package tv.blofy.player.ui.home

import android.graphics.Rect
import android.view.KeyEvent
import android.view.View
import android.view.ViewGroup
import android.view.ViewTreeObserver
import java.util.IdentityHashMap

/** Single deterministic focus engine for the TV Home screen. */
internal class HomeFocusController(
    private val root: ViewGroup,
    private val sidebar: ViewGroup,
    private val feed: ViewGroup,
    private val actions: () -> Map<String, View> = { emptyMap() },
) {
    private data class Entry(val view: View, val row: View, val sidebar: Boolean)
    private var entries = emptyList<Entry>()
    private var dirty = true
    private var disposed = false
    private val repeatGate = HomeDpadRepeatGate()
    private var lastMain: View? = null
    private var pendingFocus: View? = null
    private val layoutListener = ViewTreeObserver.OnGlobalLayoutListener { dirty = true }
    private val observer = root.viewTreeObserver

    init { observer.addOnGlobalLayoutListener(layoutListener) }

    fun resetPress() = repeatGate.reset()

    fun dispose() {
        disposed = true
        if (observer.isAlive) observer.removeOnGlobalLayoutListener(layoutListener)
        if (root.viewTreeObserver.isAlive && root.viewTreeObserver !== observer) {
            root.viewTreeObserver.removeOnGlobalLayoutListener(layoutListener)
        }
        entries = emptyList()
        lastMain = null
        pendingFocus = null
        repeatGate.reset()
    }

    fun handle(event: KeyEvent): Boolean {
        if (disposed) return false
        val direction = when (event.keyCode) {
            KeyEvent.KEYCODE_DPAD_UP -> HomeNavigationPolicy.Direction.UP
            KeyEvent.KEYCODE_DPAD_DOWN -> HomeNavigationPolicy.Direction.DOWN
            KeyEvent.KEYCODE_DPAD_LEFT -> HomeNavigationPolicy.Direction.LEFT
            KeyEvent.KEYCODE_DPAD_RIGHT -> HomeNavigationPolicy.Direction.RIGHT
            else -> return false
        }
        if (event.action == KeyEvent.ACTION_UP) { repeatGate.reset(); return true }
        if (event.action != KeyEvent.ACTION_DOWN) return false
        if (event.isCanceled) return true
        if (root.width <= 0 || feed.width <= 0) return false
        if (dirty) rebuild()
        val currentView = root.findFocus()
        if (currentView != null && entries.none { it.view === currentView }) rebuild()
        val usable = entries.filter { attachedAndFocusable(it.view) }
        if (usable.isEmpty()) return true
        if (!repeatGate.accept(event.keyCode, event.deviceId, event.downTime, event.eventTime, event.repeatCount)) return true

        val rowOrder = IdentityHashMap<View, Int>()
        for (i in 0 until feed.childCount) rowOrder[feed.getChildAt(i)] = i
        val nodes = usable.mapIndexed { index, entry ->
            HomeNavigationPolicy.Node(
                id = index,
                row = if (entry.sidebar) entry.view.top else rowOrder[entry.row] ?: -1,
                centerX = centerX(entry.view),
                sidebar = entry.sidebar,
            )
        }
        val currentIndex = usable.indexOfFirst { it.view === currentView }
        if (currentIndex < 0) {
            focus(usable.firstOrNull { it.sidebar }?.view ?: usable.first().view)
            return true
        }
        val keyByView = IdentityHashMap<View, String>()
        actions().forEach { (key, view) -> keyByView[view] = key }
        val currentKey = keyByView[currentView].orEmpty()
        fun indexOf(view: View?) = usable.indexOfFirst { it.view === view }.takeIf { it >= 0 }
        val remembered = lastMain?.takeIf { view -> usable.any { it.view === view && !it.sidebar } }
        val entry = remembered ?: preferredEntry(currentKey, usable.map { it.view }, keyByView)
        val side = actions()[sidebarKey(currentKey)]
        val targetIndex = HomeNavigationPolicy.target(
            currentIndex, nodes, direction,
            sidebarOnLeft = centerX(sidebar) < centerX(feed),
            entryId = indexOf(entry), sidebarId = indexOf(side),
        ) ?: return true
        if (targetIndex == currentIndex) return true
        if (!usable[currentIndex].sidebar && usable[targetIndex].sidebar) lastMain = currentView
        focus(usable[targetIndex].view)
        return true
    }

    /**
     * Some Android TV boxes reject requestFocus for one frame while a HorizontalScrollView is
     * settling. Keep the target and retry briefly instead of forcing the user to press LEFT/RIGHT
     * several times. A newer DPAD press replaces the pending target, so stale retries cannot jump.
     */
    private fun focus(view: View) {
        pendingFocus = view
        fun attempt(): Boolean {
            if (disposed || pendingFocus !== view || !attachedAndFocusable(view)) return false
            val moved = view.requestFocus()
            if (moved) {
                view.requestRectangleOnScreen(Rect(0, 0, view.width, view.height), true)
                pendingFocus = null
            }
            return moved
        }
        if (attempt()) return
        root.post {
            if (attempt()) return@post
            root.postDelayed({ attempt() }, 45L)
        }
    }

    private fun rebuild() {
        val found = ArrayList<View>()
        collect(root, found)
        entries = found.map { view ->
            val inSidebar = inside(view, sidebar)
            Entry(view, directChild(view, feed) ?: root, inSidebar)
        }
        dirty = false
    }

    private fun collect(view: View, result: MutableList<View>) {
        if (view.visibility != View.VISIBLE || !view.isEnabled) return
        if (view.isFocusable && view.isClickable) {
            result += view
            return
        }
        if (view is ViewGroup) for (i in 0 until view.childCount) collect(view.getChildAt(i), result)
    }

    private fun attachedAndFocusable(view: View): Boolean =
        view.isShown && view.isEnabled && view.isFocusable && view.width > 0 && view.height > 0 && inside(view, root)

    private fun inside(view: View, parent: View): Boolean {
        var cursor: View? = view
        while (cursor != null) {
            if (cursor === parent) return true
            cursor = cursor.parent as? View
        }
        return false
    }

    private fun directChild(view: View, parent: ViewGroup): View? {
        var cursor: View? = view
        while (cursor != null && cursor !== parent) {
            if (cursor.parent === parent) return cursor
            cursor = cursor.parent as? View
        }
        return null
    }

    private fun centerX(view: View): Int {
        var x = view.width / 2
        var cursor: View? = view
        while (cursor != null && cursor !== root) {
            x += cursor.left
            val parent = cursor.parent as? View
            if (parent != null) x -= parent.scrollX
            cursor = parent
        }
        return x
    }

    private fun preferredEntry(sideKey: String, views: List<View>, keys: Map<View, String>): View? {
        val prefixes = when (sideKey) {
            "side_movies" -> listOf("poster_latest_", "hero_movies")
            "side_series" -> listOf("poster_series_", "series_story", "hero_watch")
            "side_collections" -> listOf("poster_top_", "featured", "hero_movies")
            "side_favorites" -> listOf("poster_continue_", "poster_recent_", "favorite_story")
            "side_search", "side_settings" -> listOf("search_story", "hero_watch")
            else -> listOf("hero_watch", "hero_movies")
        }
        for (prefix in prefixes) views.firstOrNull { keys[it]?.startsWith(prefix) == true }?.let { return it }
        return views.firstOrNull { !inside(it, sidebar) }
    }

    private fun sidebarKey(key: String): String = when {
        key.startsWith("poster_series_") || key == "series_story" -> "side_series"
        key.startsWith("poster_continue_") || key.startsWith("poster_recent_") || key == "favorite_story" || key.isBlank() -> "side_favorites"
        key.startsWith("poster_") || key.startsWith("top10_") || key in setOf("hero_movies", "movie_story", "featured") -> "side_movies"
        key == "search_story" -> "side_search"
        else -> "side_live"
    }
}
