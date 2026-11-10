package tv.blofy.player.core.diagnostics

import androidx.annotation.OptIn
import androidx.media3.common.util.UnstableApi
import androidx.media3.common.C
import androidx.media3.common.Format
import androidx.media3.common.MimeTypes
import androidx.media3.common.TrackGroup
import androidx.media3.common.Tracks
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

@OptIn(markerClass = [UnstableApi::class])
class StreamAudioHealthTest {
    @Test
    fun selectedUnsupportedAudioIsNotMistakenForPlayableAudio() {
        // Reproduce devices with an unsupported AC3 track selected while an
        // alternate AAC track is supported but not selected.
        val audioGroup = TrackGroup(
            Format.Builder().setSampleMimeType(MimeTypes.AUDIO_AC3).build(),
            Format.Builder().setSampleMimeType(MimeTypes.AUDIO_AAC).build()
        )
        val tracks = Tracks(listOf(Tracks.Group(
            audioGroup,
            false,
            intArrayOf(C.FORMAT_UNSUPPORTED_SUBTYPE, C.FORMAT_HANDLED),
            booleanArrayOf(true, false)
        )))
        val result = StreamAudioHealth.inspect(tracks, volume = 1f)
        assertEquals(StreamAudioHealth.State.SUPPORTED_NOT_SELECTED, result.state)
        assertEquals(2, result.available)
        assertEquals(1, result.supported)
        assertEquals(0, result.selected)
        assertEquals(null, result.selectedMimeType)
    }

    @Test
    fun supportedSelectedAc3IsRecognizedWithoutClaimingAudibleSound() {
        val tracks = Tracks(listOf(Tracks.Group(
            TrackGroup(Format.Builder().setSampleMimeType(MimeTypes.AUDIO_AC3).build()),
            false,
            intArrayOf(C.FORMAT_HANDLED),
            booleanArrayOf(true)
        )))
        val result = StreamAudioHealth.inspect(tracks, volume = 1f)
        assertEquals(StreamAudioHealth.State.AUDIO_TRACK_SELECTED, result.state)
        assertEquals("audio/ac3", result.selectedMimeType)
        assertTrue(result.explanationAr().contains("إذا استمر الصمت"))
    }

    @Test
    fun silentPlayerVolumeIsReportedForSupportedAudio() {
        val tracks = Tracks(listOf(Tracks.Group(
            TrackGroup(Format.Builder().setSampleMimeType(MimeTypes.AUDIO_AAC).build()),
            false,
            intArrayOf(C.FORMAT_HANDLED),
            booleanArrayOf(true)
        )))
        val result = StreamAudioHealth.inspect(tracks, volume = 0f)
        assertEquals(StreamAudioHealth.State.PLAYER_VOLUME_MUTED, result.state)
        assertEquals(1, result.selected)
    }

    @Test
    fun distinguishesMissingUnsupportedUnselectedMutedAndSelectedAudio() {
        val s = StreamAudioHealth
        assertEquals(StreamAudioHealth.State.NOT_YET_DISCOVERED,s.classify(0,0,0,1f,false))
        assertEquals(StreamAudioHealth.State.NO_AUDIO_TRACK,s.classify(0,0,0,1f,true))
        assertEquals(StreamAudioHealth.State.UNSUPPORTED_AUDIO_CODEC,s.classify(2,0,0,1f,true))
        assertEquals(StreamAudioHealth.State.SUPPORTED_NOT_SELECTED,s.classify(2,1,0,1f,true))
        assertEquals(StreamAudioHealth.State.PLAYER_VOLUME_MUTED,s.classify(2,1,1,0f,true))
        assertEquals(StreamAudioHealth.State.AUDIO_TRACK_SELECTED,s.classify(2,1,1,1f,true))
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
