package tv.blofy.player.core.diagnostics

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class StreamAudioRecoveryPolicyTest {
    private fun allow(
        state: StreamAudioHealth.State = StreamAudioHealth.State.SUPPORTED_NOT_SELECTED,
        ready: Boolean = true,
        volume: Float = 1f,
        audioDisabled: Boolean = false,
        anySelected: Boolean = false,
        alreadyTried: Boolean = false,
        selectedUnsupported: Boolean = false,
        manualSelection: Boolean = false
    ) = StreamAudioRecoveryPolicy.shouldAttempt(
        state, ready, volume, audioDisabled, anySelected, alreadyTried,
        selectedUnsupported, manualSelection
    )

    @Test fun recoversOnlyWhenSupportedAudioExistsButNoneSelected() {
        assertTrue(allow())
        assertFalse(allow(StreamAudioHealth.State.NO_AUDIO_TRACK))
        assertFalse(allow(StreamAudioHealth.State.UNSUPPORTED_AUDIO_CODEC))
        assertFalse(allow(StreamAudioHealth.State.AUDIO_TRACK_SELECTED))
        assertFalse(allow(StreamAudioHealth.State.PLAYER_VOLUME_MUTED))
    }

    @Test fun neverOverridesIntentionalMuteTrackSelectionOrIncompleteStartup() {
        assertFalse(allow(ready = false))
        assertFalse(allow(volume = 0f))
        assertFalse(allow(audioDisabled = true))
        assertFalse(allow(anySelected = true))
        assertFalse(allow(alreadyTried = true))
    }

    @Test fun android9CanReplaceUnsupportedSelectedCodecWithSupportedAlternativeOnce() {
        // Unsupported EAC3 selected, supported AAC available: avoid a silent TV.
        assertTrue(allow(anySelected = true, selectedUnsupported = true))
        // A selected supported track must not be changed; state classifier
        // would also report AUDIO_TRACK_SELECTED in this case.
        assertFalse(allow(anySelected = true, selectedUnsupported = false))
        assertFalse(allow(anySelected = true, selectedUnsupported = true, alreadyTried = true))
    }

    @Test fun neverOverridesManualAudioChoiceOrDeliberateMute() {
        assertFalse(allow(anySelected = true, selectedUnsupported = true, manualSelection = true))
        assertFalse(allow(anySelected = true, selectedUnsupported = true, volume = 0f))
        assertFalse(allow(anySelected = true, selectedUnsupported = true, audioDisabled = true))
    }
}
