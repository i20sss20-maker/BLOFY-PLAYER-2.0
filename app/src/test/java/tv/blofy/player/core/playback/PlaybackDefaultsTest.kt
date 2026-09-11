package tv.blofy.player.core.playback

import org.junit.Assert.*
import org.junit.Test

class PlaybackDefaultsTest {
    @Test fun arabicAudioDisablesTextButEnglishAudioRestoresIt() {
        val policy = ArabicSubtitlePolicy()
        assertNull(policy.textDisabled("en"))
        assertEquals(true, policy.textDisabled("ar-SA"))
        assertEquals(false, policy.textDisabled("en-US"))
        assertNull(policy.textDisabled("fr"))
    }
    @Test fun manuallySelectedSubtitlesStaySelectedAcrossAudioChanges() {
        val policy = ArabicSubtitlePolicy()
        assertEquals(true, policy.textDisabled("ara"))
        policy.manual = true
        assertNull(policy.textDisabled("ar"))
        assertNull(policy.textDisabled("en"))
        policy.reset()
        assertEquals(true, policy.textDisabled("AR_eg"))
    }
    @Test fun unknownAudioDoesNotGuessFromAnArabicTitle() {
        val policy = ArabicSubtitlePolicy()
        assertNull(policy.textDisabled(null))
        assertNull(policy.textDisabled("und"))
        assertNull(policy.textDisabled(""))
    }
    @Test fun preparingZeroDoesNotOverwriteTheResumePosition() {
        val checkpoint = ResumeCheckpoint()
        checkpoint.reset(90_000)
        assertFalse(checkpoint.sample(0, -1, false))
        assertEquals(90_000L, checkpoint.positionMs)
        assertTrue(checkpoint.sample(96_000, 300_000, true))
        assertFalse(checkpoint.sample(0, -1, false))
        assertEquals(96_000L, checkpoint.positionMs)
        assertEquals(300_000L, checkpoint.durationMs)
    }
    @Test fun deliberateSeekToBeginningIsSavedAndNextEpisodeDoesNotInheritPosition() {
        val checkpoint = ResumeCheckpoint()
        checkpoint.sample(80_000, 300_000, true)
        assertTrue(checkpoint.sample(0, 300_000, true))
        assertEquals(0L, checkpoint.positionMs)
        checkpoint.reset()
        assertFalse(checkpoint.sample(0, -1, false))
        assertEquals(0L, checkpoint.durationMs)
    }
}
