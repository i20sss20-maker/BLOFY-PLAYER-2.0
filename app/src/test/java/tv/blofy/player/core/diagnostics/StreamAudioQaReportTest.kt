package tv.blofy.player.core.diagnostics

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class StreamAudioQaReportTest {
    @Test fun redactedAudioReportContainsUsefulAndroid9EvidenceWithoutIdentifiers() {
        val evidence = StreamAudioOutputEvidence().apply {
            onDecoderInitialized()
            onSinkError()
            onUnderrun()
        }
        val status = StreamAudioHealth.Summary(
            StreamAudioHealth.State.AUDIO_TRACK_SELECTED, 2, 1, 1, "audio/eac3"
        )
        val report = StreamAudioQaReport.create(28, 3, status, evidence)
        assertTrue(report.startsWith("BLOFY_STREAM_AUDIO_QA_V1\nandroid_sdk=28\n"))
        assertTrue(report.contains("playback_state=ready"))
        assertTrue(report.contains("audio_mime=audio/eac3"))
        assertTrue(report.contains("sink_error=1"))
        assertTrue(report.contains("underruns=1"))
        assertTrue(report.contains("audible_sound=not_verified"))
        assertFalse(report.contains("http"))
        assertFalse(report.contains("password"))
        assertFalse(report.contains("device_id"))
    }

    @Test fun untrustedMimetypeAndImpossibleCountersAreNotCopiedToClipboard() {
        val summary = StreamAudioHealth.Summary(
            StreamAudioHealth.State.AUDIO_TRACK_SELECTED,
            9999, -100, 9999, "audio/evil?password=abcdef&url=https://secret.invalid/"
        )
        val report = StreamAudioQaReport.create(999, 9999, summary, StreamAudioOutputEvidence())
        assertTrue(report.contains("android_sdk=0"))
        assertTrue(report.contains("playback_state=unknown"))
        assertTrue(report.contains("audio_mime=unknown"))
        assertTrue(report.contains("audio_total=50"))
        assertTrue(report.contains("audio_supported=0"))
        assertTrue(report.contains("audio_selected=50"))
        assertFalse(report.contains("secret.invalid"))
        assertFalse(report.contains("password"))
        assertFalse(report.contains("abcdef"))
        assertTrue(report.length < 400)
    }

    @Test fun reportsForDifferentChannelAreSeparatedByEvidenceReset() {
        val evidence = StreamAudioOutputEvidence()
        evidence.onCodecError()
        val audio = StreamAudioHealth.Summary(
            StreamAudioHealth.State.SUPPORTED_NOT_SELECTED, 1, 1, 0, null
        )
        val prior = StreamAudioQaReport.create(28, 3, audio, evidence)
        assertTrue(prior.contains("codec_error=1"))
        evidence.reset()
        val next = StreamAudioQaReport.create(28, 2, audio, evidence)
        assertEquals(false, next.contains("codec_error=1"))
        assertTrue(next.contains("codec_error=0"))
        assertFalse(next.contains("audio_mime=http"))
    }
}
