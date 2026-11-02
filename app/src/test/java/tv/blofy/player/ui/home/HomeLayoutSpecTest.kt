package tv.blofy.player.ui.home

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class HomeLayoutSpecTest {
    @Test fun tvRailFitsFullLabelsWithoutCountBadges() {
        val compactTv = HomeLayoutSpec(width = 960, height = 540, remote = true)
        assertEquals(150, compactTv.railWidth)
        assertEquals(44, compactTv.railRowHeight)
        assertTrue(compactTv.posterWidth >= 88)
        val tallerTv = HomeLayoutSpec(width = 1280, height = 720, remote = true)
        assertEquals(48, tallerTv.railRowHeight)
    }

    @Test fun phoneRemainsCompactAndDoesNotInheritTvRail() {
        val phone = HomeLayoutSpec(width = 390, height = 800, remote = false)
        assertTrue(phone.compact)
        assertEquals(136, phone.railWidth)
    }
}
