package tv.blofy.player.ui.home

import android.app.Activity
import android.app.Application
import android.graphics.Rect
import android.os.Bundle
import android.os.SystemClock
import android.view.KeyEvent
import android.view.View
import android.view.ViewGroup
import android.view.ViewTreeObserver
import java.util.WeakHashMap
import kotlin.math.roundToInt

/**
 * Stabilizes UP/DOWN D-pad navigation on the TV Home screen without touching playback code.
 * HomeActivity keeps ownership of LEFT/RIGHT; this layer only prevents Android's default focus
 * search from jumping unpredictably between the sidebar and content shelves.
 */
class HomeRemoteFocusLifecycle : Application.ActivityLifecycleCallbacks {
    private data class Binding(
        val root: View,
        val listener: ViewTreeObserver.OnGlobalLayoutListener,
    )

    private data class NavigationState(
        var lastMoveAtMs: Long = 0L,
        var lastFocusedId: Int = 0,
    )

    private val bindings = WeakHashMap<Activity, Binding>()
    private val navigationStates = WeakHashMap<Activity, NavigationState>()

    override fun onActivityResumed(activity: Activity) {
        if (activity !is HomeActivity || bindings.containsKey(activity)) return
        val root = activity.window.decorView ?: return
        navigationStates[activity] = NavigationState()
        val listener = ViewTreeObserver.OnGlobalLayoutListener { bindFocusableChildren(activity, root) }
        bindings[activity] = Binding(root, listener)
        root.viewTreeObserver.addOnGlobalLayoutListener(listener)
        root.post { bindFocusableChildren(activity, root) }
    }

    override fun onActivityPaused(activity: Activity) {
        val binding = bindings.remove(activity)
        navigationStates.remove(activity)
        if (binding != null && binding.root.viewTreeObserver.isAlive) {
            binding.root.viewTreeObserver.removeOnGlobalLayoutListener(binding.listener)
        }
    }

    private fun bindFocusableChildren(activity: HomeActivity, root: View) {
        val focusables = mutableListOf<View>()
        collectFocusable(root, focusables)
        if (focusables.isEmpty()) return

        val screenWidth = root.width.takeIf { it > 0 } ?: activity.resources.displayMetrics.widthPixels
        val sidebarBoundary = (screenWidth * 0.28f).roundToInt()
        val rowSlack = (activity.resources.displayMetrics.density * 54f).roundToInt()
        val cachedFocusables = focusables.toList()
        val state = navigationStates.getOrPut(activity) { NavigationState() }

        cachedFocusables.forEach { view ->
            view.setOnKeyListener { current, keyCode, event ->
                if (event.action != KeyEvent.ACTION_DOWN || keyCode !in setOf(KeyEvent.KEYCODE_DPAD_UP, KeyEvent.KEYCODE_DPAD_DOWN)) {
                    return@setOnKeyListener false
                }

                // Cheap TV remotes often emit several repeats for one physical press. Treat presses
                // that arrive inside the same focus-animation frame as one move, otherwise focus can
                // skip an entire shelf and feel uncontrollable.
                val now = SystemClock.uptimeMillis()
                if (event.repeatCount > 0 && now - state.lastMoveAtMs < REPEAT_GUARD_MS) {
                    return@setOnKeyListener true
                }

                val visible = cachedFocusables.filter { it.isShown && it.isEnabled && it.isFocusable && it.width > 0 && it.height > 0 }
                val nodes = visible.mapNotNull { candidate -> nodeFor(candidate, sidebarBoundary) }
                val currentNode = nodeFor(current, sidebarBoundary) ?: return@setOnKeyListener true
                val targetId = HomeRemoteFocusPolicy.vertical(
                    current = currentNode,
                    candidates = nodes,
                    down = keyCode == KeyEvent.KEYCODE_DPAD_DOWN,
                    rowSlackPx = rowSlack,
                ) ?: return@setOnKeyListener true

                val target = visible.firstOrNull { System.identityHashCode(it) == targetId } ?: return@setOnKeyListener true
                if (target.requestFocus()) {
                    state.lastMoveAtMs = now
                    state.lastFocusedId = targetId
                    target.requestRectangleOnScreen(Rect(0, 0, target.width, target.height), false)
                }
                true
            }
        }
    }

    private fun collectFocusable(view: View, out: MutableList<View>) {
        if (view.isShown && view.isEnabled && view.isFocusable) out += view
        if (view is ViewGroup) {
            for (i in 0 until view.childCount) collectFocusable(view.getChildAt(i), out)
        }
    }

    private fun nodeFor(view: View, sidebarBoundary: Int): HomeRemoteFocusPolicy.Node? {
        if (!view.isShown || !view.isEnabled || !view.isFocusable || view.width <= 0 || view.height <= 0) return null
        val location = IntArray(2)
        view.getLocationOnScreen(location)
        val centerX = location[0] + view.width / 2
        val centerY = location[1] + view.height / 2
        return HomeRemoteFocusPolicy.Node(
            id = System.identityHashCode(view),
            centerX = centerX,
            centerY = centerY,
            region = if (centerX < sidebarBoundary) REGION_SIDEBAR else REGION_CONTENT,
        )
    }

    override fun onActivityCreated(activity: Activity, savedInstanceState: Bundle?) = Unit
    override fun onActivityStarted(activity: Activity) = Unit
    override fun onActivityStopped(activity: Activity) = Unit
    override fun onActivitySaveInstanceState(activity: Activity, outState: Bundle) = Unit
    override fun onActivityDestroyed(activity: Activity) { onActivityPaused(activity) }

    private companion object {
        const val REGION_SIDEBAR = 0
        const val REGION_CONTENT = 1
        const val REPEAT_GUARD_MS = 110L
    }
}
