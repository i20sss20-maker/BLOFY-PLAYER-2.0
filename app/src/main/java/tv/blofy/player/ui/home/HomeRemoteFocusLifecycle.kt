package tv.blofy.player.ui.home

import android.app.Activity
import android.app.Application
import android.graphics.Rect
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
 * Only views that are substantially visible on screen participate. The sidebar/content boundary is
 * derived from real focus geometry instead of a fixed percentage of screen width. A fixed 28%
 * boundary was wide enough to misclassify poster cards as sidebar items on common TV layouts,
 * causing UP/DOWN jumps that looked random on the remote.
 */
class HomeRemoteFocusLifecycle : Application.ActivityLifecycleCallbacks {
    private data class Binding(
        val root: View,
        val listener: ViewTreeObserver.OnGlobalLayoutListener,
        var geometrySignature: Long = Long.MIN_VALUE,
    )

    private data class VisibleView(
        val view: View,
        val centerX: Int,
        val centerY: Int,
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

        focusables.forEach { view -> if (view.id == View.NO_ID) view.id = View.generateViewId() }

        val visible = focusables.mapNotNull(::visibleGeometry)
        if (visible.isEmpty()) return

        val screenWidth = root.width.takeIf { it > 0 } ?: activity.resources.displayMetrics.widthPixels
        val density = activity.resources.displayMetrics.density
        val sidebarBoundary = deriveSidebarBoundary(visible, screenWidth, density)
        val rowSlack = (density * 54f).roundToInt()
        val nodes = visible.map { item ->
            HomeRemoteFocusPolicy.Node(
                id = System.identityHashCode(item.view),
                centerX = item.centerX,
                centerY = item.centerY,
                region = if (item.centerX < sidebarBoundary) REGION_SIDEBAR else REGION_CONTENT,
            )
        }

        val signature = geometrySignature(nodes, visible)
        if (signature == binding.geometrySignature) return
        binding.geometrySignature = signature

        val byNodeId = visible.associateBy { System.identityHashCode(it.view) }
        val nodeById = nodes.associateBy { it.id }

        visible.forEach { currentGeometry ->
            val current = currentGeometry.view
            val currentNode = nodeById[System.identityHashCode(current)] ?: return@forEach
            val upNodeId = HomeRemoteFocusPolicy.vertical(currentNode, nodes, down = false, rowSlackPx = rowSlack)
            val downNodeId = HomeRemoteFocusPolicy.vertical(currentNode, nodes, down = true, rowSlackPx = rowSlack)
            val up = upNodeId?.let(byNodeId::get)?.view
            val down = downNodeId?.let(byNodeId::get)?.view

            current.nextFocusUpId = up?.id ?: current.id
            current.nextFocusDownId = down?.id ?: current.id
        }
    }

    private fun geometrySignature(nodes: List<HomeRemoteFocusPolicy.Node>, visible: List<VisibleView>): Long {
        var value = 1125899906842597L
        nodes.forEachIndexed { index, node ->
            val view = visible[index].view
            value = value * 31L + node.id
            value = value * 31L + node.centerX
            value = value * 31L + node.centerY
            value = value * 31L + node.region
            value = value * 31L + view.width
            value = value * 31L + view.height
        }
        return value
    }

    private fun deriveSidebarBoundary(visible: List<VisibleView>, screenWidth: Int, density: Float): Int {
        val xs = visible.map { it.centerX }.distinct().sorted()
        if (xs.size < 2) return (screenWidth * 0.20f).roundToInt()

        val maxLeft = (screenWidth * 0.42f).roundToInt()
        val minimumGap = (72f * density).roundToInt().coerceAtLeast(48)
        var bestGap = 0
        var bestBoundary: Int? = null
        for (index in 0 until xs.lastIndex) {
            val left = xs[index]
            val right = xs[index + 1]
            if (left > maxLeft) break
            val gap = right - left
            if (gap >= minimumGap && gap > bestGap) {
                bestGap = gap
                bestBoundary = left + gap / 2
            }
        }
        return bestBoundary ?: (screenWidth * 0.20f).roundToInt()
    }

    private fun visibleGeometry(view: View): VisibleView? {
        if (!view.isShown || !view.isEnabled || !view.isFocusable || view.width <= 0 || view.height <= 0) return null
        val rect = Rect()
        if (!view.getGlobalVisibleRect(rect) || rect.width() <= 0 || rect.height() <= 0) return null

        val visibleArea = rect.width().toLong() * rect.height().toLong()
        val fullArea = view.width.toLong() * view.height.toLong()
        if (fullArea > 0L && visibleArea * 4L < fullArea) return null
        return VisibleView(view, rect.centerX(), rect.centerY())
    }

    private fun collectFocusable(view: View, out: MutableList<View>) {
        if (view.isShown && view.isEnabled && view.isFocusable) out += view
        if (view is ViewGroup) {
            for (i in 0 until view.childCount) collectFocusable(view.getChildAt(i), out)
        }
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
