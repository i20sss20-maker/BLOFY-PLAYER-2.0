package tv.blofy.player.ui.home

import android.app.Activity
import android.app.Application
import android.graphics.Rect
import android.os.Bundle
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

    private val bindings = WeakHashMap<Activity, Binding>()

    override fun onActivityResumed(activity: Activity) {
        if (activity !is HomeActivity || bindings.containsKey(activity)) return
        val root = activity.window.decorView ?: return
        val listener = ViewTreeObserver.OnGlobalLayoutListener { bindFocusableChildren(activity, root) }
        bindings[activity] = Binding(root, listener)
        root.viewTreeObserver.addOnGlobalLayoutListener(listener)
        root.post { bindFocusableChildren(activity, root) }
    }

    override fun onActivityPaused(activity: Activity) {
        val binding = bindings.remove(activity) ?: return
        if (binding.root.viewTreeObserver.isAlive) {
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

        // Keep the focusable view list from the latest layout pass. A rapid D-pad press must not
        // recursively walk the complete Home view tree on every key event. Coordinates are still
        // refreshed below, so scrolling/dynamic shelves remain accurate without the expensive scan.
        val cachedFocusables = focusables.toList()

        cachedFocusables.forEach { view ->
            view.setOnKeyListener { current, keyCode, event ->
                if (event.action != KeyEvent.ACTION_DOWN || keyCode !in setOf(KeyEvent.KEYCODE_DPAD_UP, KeyEvent.KEYCODE_DPAD_DOWN)) {
                    return@setOnKeyListener false
                }

                val visible = cachedFocusables.filter { it.isShown && it.isEnabled && it.isFocusable }
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
    }
}
