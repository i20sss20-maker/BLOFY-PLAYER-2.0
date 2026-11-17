package tv.blofy.player.ui.player

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.assertFalse
import org.junit.Test

class LiveChannelPanelPolicyTest {
    @Test fun mainControlsStayCompactWhileAdvancedControlsExpandBelow() {
        assertEquals(listOf(LiveChannelPanelAction.BLOFY_AUDIO, LiveChannelPanelAction.MORE),
            LiveChannelPanelPolicy.actions(true))
        assertTrue(LiveChannelPanelPolicy.actions(true, true)
            .containsAll(listOf(LiveChannelPanelAction.AUDIO_TRACKS,
                LiveChannelPanelAction.SUBTITLES, LiveChannelPanelAction.VIDEO_QUALITY,
                LiveChannelPanelAction.STREAM_INFO, LiveChannelPanelAction.RECONNECT,
                LiveChannelPanelAction.FAVORITE, LiveChannelPanelAction.EPG)))
    }
    @Test fun legacyBlofyPlayerUnchanged() {
        assertTrue(LiveChannelPanelPolicy.actions(false).isEmpty())
        assertTrue(LiveChannelPanelPolicy.actions(false, true).isEmpty())
    }
    @Test fun arabicEnglishChannelSearchAndRecents() {
        assertTrue(LiveChannelPanelPolicy.matchesSearch("قناة الرياضة", "الرياضة"))
        assertTrue(LiveChannelPanelPolicy.matchesSearch("beIN SPORTS 1", "sports"))
        assertFalse(LiveChannelPanelPolicy.matchesSearch("Sports 2", "News"))
        assertEquals(listOf("C", "A"),
            LiveChannelPanelPolicy.orderedByRecent(listOf("A", "B", "C"), listOf("C", "A", "C")) { it })
    }
    @Test fun changingChannelsKeepsFocusOnTheLastHighlightedRow() {
        val keys = listOf("BLOFY 1", "BLOFY 2", "BLOFY 3")
        assertEquals(1, LiveChannelPanelPolicy.initialChannelIndex(keys, "BLOFY 2", "BLOFY 1") { it })
        assertEquals(2, LiveChannelPanelPolicy.initialChannelIndex(keys, "unavailable", "BLOFY 3") { it })
    }

    @Test fun firstOrMissingChannelFallsBackToFirstRowNotSearch() {
        assertEquals(0, LiveChannelPanelPolicy.initialChannelIndex(listOf("BLOFY 1", "BLOFY 2"), null, null) { it })
        assertEquals(-1, LiveChannelPanelPolicy.initialChannelIndex(emptyList<String>(), "missing", null) { it })
    }

    @Test fun rowsVisibleAboveFooter() {
        val tv = LiveChannelPanelPolicy.dimensions(true, false)
        val phone = LiveChannelPanelPolicy.dimensions(false, false)
        assertEquals(0.31f, tv.first)
        assertEquals(0.94f, tv.second)
        assertEquals(0.82f, phone.first)
    }
}
