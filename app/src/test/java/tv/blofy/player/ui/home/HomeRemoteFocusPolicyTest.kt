package tv.blofy.player.ui.home

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class HomeRemoteFocusPolicyTest {
    @Test fun downChoosesSameColumnOnNearestRow() {
        val current = node(1, 900, 100, 1)
        val candidates = listOf(current, node(2, 200, 300, 1), node(3, 880, 310, 1), node(4, 910, 600, 1))
        assertEquals(3, HomeRemoteFocusPolicy.vertical(current, candidates, down = true, rowSlackPx = 60))
    }

    @Test fun upChoosesNearestVisualRowBeforeFartherRow() {
        val current = node(1, 700, 700, 1)
        val candidates = listOf(current, node(2, 690, 500, 1), node(3, 700, 200, 1))
        assertEquals(2, HomeRemoteFocusPolicy.vertical(current, candidates, down = false, rowSlackPx = 40))
    }

    @Test fun verticalNeverCrossesSidebarAndContentRegions() {
        val current = node(1, 110, 300, 0)
        val candidates = listOf(current, node(2, 120, 500, 0), node(3, 400, 350, 1))
        assertEquals(2, HomeRemoteFocusPolicy.vertical(current, candidates, down = true, rowSlackPx = 80))
    }

    @Test fun edgeStaysPutInsteadOfJumpingElsewhere() {
        val current = node(1, 500, 100, 1)
        assertNull(HomeRemoteFocusPolicy.vertical(current, listOf(current, node(2, 500, 300, 1)), down = false, rowSlackPx = 50))
    }

    private fun node(id: Int, x: Int, y: Int, region: Int) = HomeRemoteFocusPolicy.Node(id, x, y, region)
}
