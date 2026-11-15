package tv.blofy.player.ui.player

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class LiveChannelPanelPolicyTest {
    @Test fun streamButtonsStayAttachedBelowListInPredictableVerticalOrder() {
        assertEquals(listOf(
            LiveChannelPanelAction.BLOFY_AUDIO,
            LiveChannelPanelAction.AUDIO_TRACKS,
            LiveChannelPanelAction.SUBTITLES,
            LiveChannelPanelAction.VIDEO_QUALITY,
            LiveChannelPanelAction.FAVORITE
        ), LiveChannelPanelPolicy.actions(streamCodeOnly = true))
    }

    @Test fun existingBlofyPlayerRemainsUnchanged() {
        assertTrue(LiveChannelPanelPolicy.actions(streamCodeOnly = false).isEmpty())
    }

    @Test fun channelRowsRemainVisibleAboveFooterOnTvAndPhone() {
        val tv = LiveChannelPanelPolicy.dimensions(isTv = true, isTablet = false)
        val phone = LiveChannelPanelPolicy.dimensions(isTv = false, isTablet = false)
        assertEquals(0.30f, tv.first)
        assertEquals(0.84f, tv.second)
        assertEquals(0.82f, phone.first)
        assertEquals(0.90f, phone.second)
    }
}
