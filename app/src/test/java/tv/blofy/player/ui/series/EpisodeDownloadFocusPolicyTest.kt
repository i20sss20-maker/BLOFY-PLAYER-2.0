package tv.blofy.player.ui.series

import android.view.KeyEvent
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class EpisodeDownloadFocusPolicyTest {
    @Test fun ltrTvRemoteCanReachDownloadAndReturnToEpisode() {
        assertTrue(EpisodeDownloadFocusPolicy.towardsDownload(KeyEvent.KEYCODE_DPAD_RIGHT, false))
        assertFalse(EpisodeDownloadFocusPolicy.towardsDownload(KeyEvent.KEYCODE_DPAD_LEFT, false))
        assertTrue(EpisodeDownloadFocusPolicy.towardsEpisode(KeyEvent.KEYCODE_DPAD_LEFT, false))
        assertFalse(EpisodeDownloadFocusPolicy.towardsEpisode(KeyEvent.KEYCODE_DPAD_RIGHT, false))
    }

    @Test fun arabicRtlTvRemoteUsesCorrectReverseDirections() {
        assertTrue(EpisodeDownloadFocusPolicy.towardsDownload(KeyEvent.KEYCODE_DPAD_LEFT, true))
        assertFalse(EpisodeDownloadFocusPolicy.towardsDownload(KeyEvent.KEYCODE_DPAD_RIGHT, true))
        assertTrue(EpisodeDownloadFocusPolicy.towardsEpisode(KeyEvent.KEYCODE_DPAD_RIGHT, true))
        assertFalse(EpisodeDownloadFocusPolicy.towardsEpisode(KeyEvent.KEYCODE_DPAD_LEFT, true))
    }

    @Test fun selectAndVerticalKeysNeverInterceptEpisodePlaybackOrDownload() {
        for (key in listOf(
            KeyEvent.KEYCODE_DPAD_CENTER,
            KeyEvent.KEYCODE_ENTER,
            KeyEvent.KEYCODE_DPAD_UP,
            KeyEvent.KEYCODE_DPAD_DOWN,
            KeyEvent.KEYCODE_BACK
        )) {
            assertFalse(EpisodeDownloadFocusPolicy.towardsDownload(key, true))
            assertFalse(EpisodeDownloadFocusPolicy.towardsEpisode(key, false))
        }
    }
}
