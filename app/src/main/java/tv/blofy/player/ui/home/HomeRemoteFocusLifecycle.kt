package tv.blofy.player.ui.home

import android.app.Activity
import android.app.Application
import android.os.Bundle
import android.view.View
import android.view.ViewGroup
import android.view.ViewTreeObserver
import java.util.WeakHashMap
import kotlin.math.roundToInt

/**
 * Builds a stable UP/DOWN focus graph for the TV Home screen without intercepting key events.
 * HomeActivity remains the only owner of LEFT/RIGHT dispatch; Android follows explicit
 * nextFocusUpId/nextFocusDownId links for vertical movement instead of running unpredictable
 * FocusFinder searches across the sidebar and dynamic shelves on every remote press.
 *
 * Dynamic hero/artwork/text updates can trigger many global-layout callbacks even when focusable
 * geometry did not change. Rewriting the graph on every callback made real remotes feel jumpy.
 * We therefore rebuild only when the set/position/size of focusable views actually changes.
 */
class HomeRemoteFocusLifecycle : Application.ActivityLifecycleCallbacks {
    private data class Binding(
        val root: View,
        val listener: ViewTreeObserver.OnGlobalLayoutListener,
        var geometrySignature: Long = Long.MIN_VALUE,
    )

    private val bindings = WeakHashMap<Activity, Binding>()

    override fun onActivityResumed(activity: Activity) {
        if (activity !is HomeActivity || bindings.containsKey(activity)) return
        val root = activity.window.decorView ?: return
        val listener = ViewTreeObserver.OnGlobalLayoutListener { rebuildFocusGraph(activity, root) }
        bindings[activity] = Binding(root, listener)
        root.viewTreeObserver.addOnGlobalLayoutListener(listener)
        root.post { rebuildFocusGraph(activity, root) }
    }

    override fun onActivityPaused(activity: Activity) {
        val binding = bindings.remove(activity)
        if (binding != null && binding.root.viewTreeObserver.isAlive) {
            binding.root.viewTreeObserver.removeOnGlobalLayoutListener(binding.listener)
        }
    }

    private fun rebuildFocusGraph(activity: HomeActivity, root: View) {
        val binding = bindings[activity] ?: return
        val focusables = mutableListOf<View>()
        collectFocusable(root, focusables)
        if (focusables.isEmpty()) return

        focusables.forEach { view ->
            if (view.id == View.NO_ID) view.id = View.generateViewId()
        }

        val visible = focusables.filter { it.isShown && it.isEnabled && it.isFocusable && it.width > 0 && it.height > 0 }
        if (visible.isEmpty()) return

        val screenWidth = root.width.takeIf { it > 0 } ?: activity.resources.displayMetrics.widthPixels
        val sidebarBoundary = (screenWidth * 0.28f).roundToInt()
        val rowSlack = (activity.resources.displayMetrics.density * 54f).roundToInt()
        val nodes = visible.mapNotNull { nodeFor(it, sidebarBoundary) }
        if (nodes.isEmpty()) return

        val signature = geometrySignature(nodes, visible)
        if (signature == binding.geometrySignature) return
        binding.geometrySignature = signature

        val byNodeId = visible.associateBy { System.identityHashCode(it) }
        val nodeById = nodes.associateBy { it.id }

        visible.forEach { current ->
            val currentNode = nodeById[System.identityHashCode(current)] ?: return@forEach
            val upNodeId = HomeRemoteFocusPolicy.vertical(
                current = currentNode,
                candidates = nodes,
                down = false,
                rowSlackPx = rowSlack,
            )
            val downNodeId = HomeRemoteFocusPolicy.vertical(
                current = currentNode,
                candidates = nodes,
                down = true,
                rowSlackPx = rowSlack,
            )
            val up = upNodeId?.let(byNodeId::get)
            val down = downNodeId?.let(byNodeId::get)

            // Explicit self-links keep focus inside the current region at an edge instead of letting
            // Android jump sideways into the sidebar or into an unrelated header control.
            current.nextFocusUpId = up?.id ?: current.id
            current.nextFocusDownId = down?.id ?: current.id
        }
    }

    private fun geometrySignature(nodes: List<HomeRemoteFocusPolicy.Node>, views: List<View>): Long {
        var value = 1125899906842597L
        nodes.forEachIndexed { index, node ->
            val view = views[index]
            value = value * 31L + node.id
            value = value * 31L + node.centerX
            value = value * 31L + node.centerY
            value = value * 31L + node.region
            value = value * 31L + view.width
            value = value * 31L + view.height
        }
        return value
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
