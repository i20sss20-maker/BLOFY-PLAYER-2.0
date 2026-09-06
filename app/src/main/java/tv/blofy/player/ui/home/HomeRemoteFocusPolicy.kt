package tv.blofy.player.ui.home

import kotlin.math.abs

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
        val directional = candidates.filter { node ->
            node.id != current.id && node.region == current.region &&
                if (down) node.centerY > current.centerY else node.centerY < current.centerY
        }
        if (directional.isEmpty()) return null

        val nearestDeltaY = directional.minOf { abs(it.centerY - current.centerY) }
        return directional
            .asSequence()
            .filter { abs(it.centerY - current.centerY) <= nearestDeltaY + rowSlackPx.coerceAtLeast(0) }
            .minWithOrNull(compareBy<Node>({ abs(it.centerX - current.centerX) }, { abs(it.centerY - current.centerY) }))
            ?.id
    }
}
