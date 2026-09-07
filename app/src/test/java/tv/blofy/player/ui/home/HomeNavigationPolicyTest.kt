package tv.blofy.player.ui.home

import org.junit.Assert.*
import org.junit.Test
import tv.blofy.player.ui.home.HomeNavigationPolicy.Direction.*
import tv.blofy.player.ui.home.HomeNavigationPolicy.Node

class HomeNavigationPolicyTest {
    private val nodes = listOf(
        Node(1, 0, 90, true), Node(2, 1, 90, true), Node(3, 2, 90, true),
        Node(4, -1, 1000),
        Node(5, 0, 950), Node(6, 0, 750),
        Node(7, 2, 960), Node(8, 2, 760), Node(9, 2, -100),
        Node(10, 4, 780),
    )
    private fun move(id: Int, direction: HomeNavigationPolicy.Direction, source: List<Node> = nodes) =
        HomeNavigationPolicy.target(id, source, direction, entryId = 5, sidebarId = 2)

    @Test fun physicalLeftAndRightDoNotDependOnInsertionOrderOrLocale() {
        assertEquals(6, move(5, LEFT)); assertEquals(5, move(6, RIGHT))
        assertEquals(6, move(5, LEFT, nodes.reversed()))
    }
    @Test fun contentOuterEdgeStaysPut() { assertEquals(5, move(5, RIGHT)) }
    @Test fun contentSidebarEdgeAndRoundTripUseExplicitTargets() {
        assertEquals(2, move(6, LEFT)); assertEquals(5, move(2, RIGHT))
    }
    @Test fun sidebarUpAndDownNeverEnterContent() {
        assertEquals(1, move(1, UP)); assertEquals(2, move(1, DOWN))
        assertEquals(3, move(3, DOWN)); assertEquals(2, move(3, UP))
    }
    @Test fun sidebarOutsideEdgeStaysPut() { assertEquals(2, move(2, LEFT)) }
    @Test fun verticalSelectsAdjacentRealRowThenNearestColumn() {
        assertEquals(8, move(6, DOWN)); assertEquals(6, move(8, UP))
        assertEquals(10, move(8, DOWN))
    }
    @Test fun offscreenCardsRemainContentNotSidebar() { assertEquals(6, move(9, UP)) }
    @Test fun headerIsReachableAndBottomCannotWrap() {
        assertEquals(4, move(5, UP)); assertEquals(5, move(4, DOWN)); assertEquals(10, move(10, DOWN))
    }
    @Test fun removedRowsAndItemsAreNotTargets() {
        assertEquals(10, move(6, DOWN, nodes.filterNot { it.row == 2 && !it.sidebar }))
        assertNull(move(200, DOWN))
    }
    @Test fun mirroredSidebarUsesPhysicalDirection() {
        val mirrored = nodes.map { it.copy(centerX = 1280 - it.centerX) }
        assertEquals(2, HomeNavigationPolicy.target(6, mirrored, RIGHT, false, sidebarId = 2))
        assertEquals(5, HomeNavigationPolicy.target(2, mirrored, LEFT, false, entryId = 5))
    }
    @Test fun stalePreferredEntryFallsBackToAnExistingMainNode() {
        val target = HomeNavigationPolicy.target(2, nodes, RIGHT, entryId = 400)
        assertTrue(nodes.any { it.id == target && !it.sidebar })
    }
    @Test fun heldKeyIsPacedButSeparateRapidTapsAreAccepted() {
        val gate = HomeDpadRepeatGate()
        assertTrue(gate.accept(20, 1, 1000, 1000, 0))
        assertFalse(gate.accept(20, 1, 1000, 1020, 1))
        assertTrue(gate.accept(20, 1, 1000, 1100, 2))
        assertTrue(gate.accept(20, 1, 1110, 1110, 0))
        assertTrue(gate.accept(19, 1, 1115, 1115, 0))
    }
    @Test fun pressStateResetsAndDoesNotLeakAcrossRemotes() {
        val gate = HomeDpadRepeatGate()
        gate.accept(20, 1, 1000, 1000, 0)
        assertTrue(gate.accept(20, 2, 1000, 1001, 1))
        gate.reset()
        assertTrue(gate.accept(20, 2, 1000, 1002, 1))
    }
    @Test fun emptyHierarchyIsSafe() { assertNull(HomeNavigationPolicy.target(0, emptyList(), DOWN)) }
}
