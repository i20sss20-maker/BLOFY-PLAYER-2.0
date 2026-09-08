package tv.blofy.player.ui.home

import kotlin.math.abs

/** One physical D-pad policy. Row membership comes from the layout, never screen percentages. */
internal object HomeNavigationPolicy {
    enum class Direction { UP, DOWN, LEFT, RIGHT }
    data class Node(val id: Int, val row: Int, val centerX: Int, val sidebar: Boolean = false)

    fun target(
        currentId: Int,
        nodes: List<Node>,
        direction: Direction,
        sidebarOnLeft: Boolean = true,
        entryId: Int? = null,
        sidebarId: Int? = null,
    ): Int? {
        val current = nodes.firstOrNull { it.id == currentId } ?: return null
        if (direction == Direction.UP || direction == Direction.DOWN) {
            val down = direction == Direction.DOWN
            val candidates = nodes.filter {
                it.sidebar == current.sidebar && if (down) it.row > current.row else it.row < current.row
            }
            val row = if (down) candidates.minOfOrNull { it.row } else candidates.maxOfOrNull { it.row }
            return candidates.asSequence().filter { it.row == row }
                .minWithOrNull(compareBy<Node>({ abs(it.centerX.toLong() - current.centerX) }, { it.id }))?.id
                ?: current.id
        }

        val left = direction == Direction.LEFT
        val towardSidebar = left == sidebarOnLeft
        if (current.sidebar) {
            if (towardSidebar) return current.id
            nodes.firstOrNull { it.id == entryId && !it.sidebar }?.let { return it.id }
            val firstRow = nodes.filterNot { it.sidebar }.minOfOrNull { it.row }
            return nodes.filter { !it.sidebar && it.row == firstRow }
                .minByOrNull { abs(it.centerX.toLong() - current.centerX) }?.id ?: current.id
        }

        val next = nodes.asSequence().filter {
            !it.sidebar && it.row == current.row && it.id != current.id &&
                if (left) it.centerX < current.centerX else it.centerX > current.centerX
        }.minWithOrNull(compareBy<Node>({ abs(it.centerX.toLong() - current.centerX) }, { it.id }))
        if (next != null) return next.id
        if (!towardSidebar) return current.id
        return nodes.firstOrNull { it.id == sidebarId && it.sidebar }?.id
            ?: nodes.filter { it.sidebar }.minByOrNull { it.row }?.id ?: current.id
    }
}

/** Only repeats of the same held key are paced. Separate quick taps/direction changes are not lost. */
internal class HomeDpadRepeatGate(private val intervalMs: Long = 75L) {
    private var key = -1
    private var device = -1
    private var downAt = Long.MIN_VALUE
    private var acceptedAt = Long.MIN_VALUE

    fun accept(code: Int, deviceId: Int, downTime: Long, eventTime: Long, repeat: Int): Boolean {
        val samePress = code == key && deviceId == device && downTime == downAt
        if (repeat > 0 && samePress && eventTime >= acceptedAt && eventTime - acceptedAt < intervalMs) return false
        key = code
        device = deviceId
        downAt = downTime
        acceptedAt = eventTime
        return true
    }

    fun reset() { key = -1; device = -1; downAt = Long.MIN_VALUE; acceptedAt = Long.MIN_VALUE }
}
