package tv.blofy.player.ui.player

import org.junit.Assert.*
import org.junit.Test

class AudioTrackChoicePolicyTest {
    @Test fun audioDialogStartsWithAutomaticAndNeverOffsetsTrackSelection() {
        val p = AudioTrackChoicePolicy
        assertEquals(p.Choice.AUTO, p.choice(audio = true, subtitles = false,
            option = 0, availableTracks = 2))
        assertEquals(0, p.trackIndex(true, false, 1, 2))
        assertEquals(1, p.trackIndex(true, false, 2, 2))
        assertNull(p.choice(true, false, 3, 2))
    }

    @Test fun subtitleOffRemainsFirstAndDoesNotChangeExistingTrackMapping() {
        val p = AudioTrackChoicePolicy
        assertEquals(p.Choice.OFF, p.choice(false, true, 0, 1))
        assertEquals(0, p.trackIndex(false, true, 1, 1))
    }

    @Test fun emptyAudioStreamsStillShowDiagnosisInsteadOfFakeAutoChoice() {
        assertNull(AudioTrackChoicePolicy.choice(true, false, 0, 0))
        assertEquals(0, AudioTrackChoicePolicy.optionOffset(true, false, 0))
    }
}
