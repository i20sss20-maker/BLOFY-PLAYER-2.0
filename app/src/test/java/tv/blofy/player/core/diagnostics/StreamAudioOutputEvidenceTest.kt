package tv.blofy.player.core.diagnostics

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class StreamAudioOutputEvidenceTest {
    private fun selectedAudio() = StreamAudioHealth.Summary(
        StreamAudioHealth.State.AUDIO_TRACK_SELECTED, 1, 1, 1, "audio/eac3"
    )

    @Test fun rendererAndSinkSignalsNeverClaimAudibleSound() {
        val evidence = StreamAudioOutputEvidence()
        assertEquals(StreamAudioOutputEvidence.Signal.WAITING_FOR_DECODER, evidence.signal())
        evidence.onDecoderInitialized()
        assertEquals(StreamAudioOutputEvidence.Signal.DECODER_INITIALIZED, evidence.signal())
        evidence.onPositionAdvancing()
        assertEquals(StreamAudioOutputEvidence.Signal.AUDIO_POSITION_ADVANCED, evidence.signal())
        assertTrue(evidence.summary(selectedAudio(), "ar-SA").contains("لا يؤكد سماع الصوت"))
        assertTrue(evidence.summary(selectedAudio(), "en").contains("does not confirm audible"))
        assertFalse(evidence.safeCode().contains("audio/eac3"))
    }

    @Test fun sinkAndCodecEventsAreWarningsNotAutomaticRetryCommands() {
        val evidence = StreamAudioOutputEvidence()
        evidence.onDecoderInitialized()
        evidence.onPositionAdvancing()
        evidence.onSinkError()
        assertEquals(StreamAudioOutputEvidence.Signal.SINK_ERROR_OBSERVED, evidence.signal())
        assertTrue(evidence.summary(selectedAudio(), "ar").contains("قد يكون مؤقتًا"))
        evidence.onCodecError()
        assertEquals(StreamAudioOutputEvidence.Signal.CODEC_ERROR_OBSERVED, evidence.signal())
        assertTrue(evidence.summary(selectedAudio(), "en").contains("decoder error"))
    }

    @Test fun underrunsAreCappedAndResetOnNextChannel() {
        val evidence = StreamAudioOutputEvidence()
        repeat(1000) { evidence.onUnderrun() }
        assertTrue(evidence.safeCode().contains("underruns=5"))
        evidence.onPositionAdvancing()
        evidence.reset()
        assertEquals(StreamAudioOutputEvidence.Signal.WAITING_FOR_DECODER, evidence.signal())
        assertEquals(
            "decoder=0;advancing=0;sink_error=0;codec_error=0;underruns=0",
            evidence.safeCode()
        )
    }

    @Test fun absentOrUnsupportedTrackIsNotMisreportedAsDecoded() {
        val evidence = StreamAudioOutputEvidence()
        evidence.onDecoderInitialized()
        evidence.onPositionAdvancing()
        val unsupported = StreamAudioHealth.Summary(
            StreamAudioHealth.State.UNSUPPORTED_AUDIO_CODEC, 1, 0, 0, null
        )
        assertTrue(evidence.summary(unsupported, "ar").contains("لم يثبت"))
        assertTrue(evidence.summary(unsupported, "en").contains("not been established"))
    }
}
