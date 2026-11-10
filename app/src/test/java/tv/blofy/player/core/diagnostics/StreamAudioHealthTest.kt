package tv.blofy.player.core.diagnostics

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class StreamAudioHealthTest {
    @Test
    fun distinguishesMissingUnsupportedUnselectedMutedAndSelectedAudio() {
        val s = StreamAudioHealth
        assertEquals(s.State.NOT_YET_DISCOVERED,s.classify(0,0,0,1f,false))
        assertEquals(s.State.NO_AUDIO_TRACK,s.classify(0,0,0,1f,true))
        assertEquals(s.State.UNSUPPORTED_AUDIO_CODEC,s.classify(2,0,0,1f,true))
        assertEquals(s.State.SUPPORTED_NOT_SELECTED,s.classify(2,1,0,1f,true))
        assertEquals(s.State.PLAYER_VOLUME_MUTED,s.classify(2,1,1,0f,true))
        assertEquals(s.State.AUDIO_TRACK_SELECTED,s.classify(2,1,1,1f,true))
    }

    @Test
    fun diagnosticsDoNotTreatSelectionAsConfirmedAudibleAudio() {
        val selected=StreamAudioHealth.Summary(
            StreamAudioHealth.State.AUDIO_TRACK_SELECTED,1,1,1,"audio/ac3")
        assertTrue(selected.explanationAr().contains("إذا استمر الصمت"))
        assertFalse(selected.safeLogCode().contains("http://"))
        assertFalse(selected.safeLogCode().contains("password"))
        assertTrue(selected.safeLogCode().contains("mime=audio/ac3"))
    }

    @Test
    fun unsupportedAudioGivesRelevantGuidanceWithoutRebuildingPlayback() {
        val unsupported=StreamAudioHealth.Summary(
            StreamAudioHealth.State.UNSUPPORTED_AUDIO_CODEC,1,0,0,null)
        assertTrue(unsupported.explanationAr().contains("لا يدعم الترميز"))
        assertEquals("state=UNSUPPORTED_AUDIO_CODEC;available=1;supported=0;selected=0;mime=none",
            unsupported.safeLogCode())
    }
}
