package tv.blofy.player.ui.home

import kotlin.math.abs
import kotlin.math.max

/**
 * Deterministic vertical D-pad movement for the TV home screen.
 *
 * Horizontal movement remains owned by HomeActivity. For vertical movement we first pick the
 * nearest visual row, then the item in that row whose horizontal center is closest to the current
 * item. Sidebar and content are deliberately separate regions so UP/DOWN can never jump across
 * the two columns.
 */
object HomeRemoteFocusPolicy {
    data class Node(
        val id: Int,
        val centerX: Int,
        val centerY: Int,
        val region: Int,
    )

    fun vertical(current: Node, candidates: List<Node>, down: Boolean, rowSlackPx: Int): Int? {
        // Views inside one visual shelf do not always share the exact same centerY (buttons,
        // badges and cards can differ by a few pixels). Ignore tiny vertical deltas so a single
        // UP/DOWN press can never jump sideways inside the same shelf.
        val minRowDeltaPx = max(12, rowSlackPx.coerceAtLeast(0) / 2)
        val directional = candidates.filter { node ->
            if (node.id == current.id || node.region != current.region) return@filter false
            val deltaY = node.centerY - current.centerY
            if (abs(deltaY) < minRowDeltaPx) return@filter false
            if (down) deltaY > 0 else deltaY < 0
        }
        if (directional.isEmpty()) return null

        val nearestDeltaY = directional.minOf { abs(it.centerY - current.centerY) }
        val rowWindow = max(8, rowSlackPx.coerceAtLeast(0) / 2)
        return directional
            .asSequence()
            .filter { abs(abs(it.centerY - current.centerY) - nearestDeltaY) <= rowWindow }
            .minWithOrNull(compareBy<Node>({ abs(it.centerX - current.centerX) }, { abs(it.centerY - current.centerY) }))
            ?.id
    }
}
