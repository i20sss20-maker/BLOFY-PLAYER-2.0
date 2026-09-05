package tv.blofy.player.ui.home

import org.junit.Assert.*
import org.junit.Test

class HomeFocusPolicyRegressionTest {
    @Test fun leftInRtlRowVisitsNeighborBeforeSidebar() {
        assertEquals(HomeFocusPolicy.Move.Item(1), HomeFocusPolicy.horizontal(0, 3, left = true, rtl = true))
        assertEquals(HomeFocusPolicy.Move.Item(2), HomeFocusPolicy.horizontal(1, 3, left = true, rtl = true))
        assertSame(HomeFocusPolicy.Move.Sidebar, HomeFocusPolicy.horizontal(2, 3, left = true, rtl = true))
    }

    @Test fun rightAtRtlEdgeStaysInContent() {
        assertSame(HomeFocusPolicy.Move.Stay, HomeFocusPolicy.horizontal(0, 3, left = false, rtl = true))
        assertEquals(HomeFocusPolicy.Move.Item(0), HomeFocusPolicy.horizontal(1, 3, left = false, rtl = true))
    }

    @Test fun physicalLeftSidebarRuleAlsoWorksForLtrRows() {
        assertEquals(HomeFocusPolicy.Move.Item(0), HomeFocusPolicy.horizontal(1, 3, left = true, rtl = false))
        assertSame(HomeFocusPolicy.Move.Sidebar, HomeFocusPolicy.horizontal(0, 3, left = true, rtl = false))
        assertSame(HomeFocusPolicy.Move.Stay, HomeFocusPolicy.horizontal(2, 3, left = false, rtl = false))
    }

    @Test fun emptyRowsAndStaleIndicesDoNotMoveFocus() {
        assertSame(HomeFocusPolicy.Move.Stay, HomeFocusPolicy.horizontal(0, 0, true, true))
        assertSame(HomeFocusPolicy.Move.Stay, HomeFocusPolicy.horizontal(-1, 3, true, true))
        assertSame(HomeFocusPolicy.Move.Stay, HomeFocusPolicy.horizontal(3, 3, true, true))
    }

    @Test fun posterGroupingKeepsRowsSeparateAndMixedContentTogether() {
        assertEquals("poster_latest", HomeFocusPolicy.row("poster_latest_movie_0"))
        assertEquals("poster_latest", HomeFocusPolicy.row("poster_latest_series_1"))
        assertEquals("poster_continue", HomeFocusPolicy.row("poster_continue_movie_2"))
        assertEquals("top10", HomeFocusPolicy.row("top10_1"))
        assertEquals("hero", HomeFocusPolicy.row("hero_watch"))
        assertNull(HomeFocusPolicy.row("side_movies"))
    }
}
