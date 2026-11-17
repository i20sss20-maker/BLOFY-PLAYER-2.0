package tv.blofy.player.ui.player

import androidx.annotation.OptIn
import androidx.media3.common.C
import androidx.media3.common.Format
import androidx.media3.common.MimeTypes
import androidx.media3.common.TrackGroup
import androidx.media3.common.TrackSelectionOverride
import androidx.media3.common.TrackSelectionParameters
import androidx.media3.common.util.UnstableApi
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(manifest = Config.NONE, sdk = [28])
@OptIn(markerClass = [UnstableApi::class])
class StreamAudioChannelTransitionTest {
    private val audioGroup = TrackGroup(
        Format.Builder().setSampleMimeType(MimeTypes.AUDIO_E_AC3).build(),
        Format.Builder().setSampleMimeType(MimeTypes.AUDIO_AAC).build()
    )
    private val textGroup = TrackGroup(
        Format.Builder().setSampleMimeType(MimeTypes.TEXT_VTT).build()
    )
    private val videoGroup = TrackGroup(
        Format.Builder().setSampleMimeType(MimeTypes.VIDEO_H264).build()
    )

    @Test fun differentChannelDropsOnlyOldAudioOverrideAndReenablesAudio() {
        val old = TrackSelectionParameters.DEFAULT.buildUpon()
            .setOverrideForType(TrackSelectionOverride(audioGroup, listOf(1)))
            .setOverrideForType(TrackSelectionOverride(textGroup, listOf(0)))
            .setOverrideForType(TrackSelectionOverride(videoGroup, listOf(0)))
            .setTrackTypeDisabled(C.TRACK_TYPE_AUDIO, true)
            .setPreferredAudioLanguage("ar")
            .build()
        assertTrue(StreamAudioChannelTransition.hasManualAudioOverride(old))
        val fresh = StreamAudioChannelTransition.forDifferentLiveChannel(old)
        assertFalse(StreamAudioChannelTransition.hasManualAudioOverride(fresh))
        assertFalse(fresh.disabledTrackTypes.contains(C.TRACK_TYPE_AUDIO))
        assertEquals(listOf("ar"), fresh.preferredAudioLanguages)
        assertTrue(fresh.overrides.containsKey(textGroup))
        assertTrue(fresh.overrides.containsKey(videoGroup))
        assertFalse(fresh.overrides.containsKey(audioGroup))
        // Do not mutate the previous channel's snapshot (for system resume).
        assertTrue(old.overrides.containsKey(audioGroup))
        assertTrue(old.disabledTrackTypes.contains(C.TRACK_TYPE_AUDIO))
    }

    @Test fun defaultChannelHasNoManualAudioSelectionAndRemainsUsable() {
        val base = TrackSelectionParameters.DEFAULT
        assertFalse(StreamAudioChannelTransition.hasManualAudioOverride(base))
        val reset = StreamAudioChannelTransition.forDifferentLiveChannel(base)
        assertFalse(reset.disabledTrackTypes.contains(C.TRACK_TYPE_AUDIO))
        assertFalse(StreamAudioChannelTransition.hasManualAudioOverride(reset))
    }

    @Test fun channelTransitionPreservesUserSubtitleChoice() {
        val base = TrackSelectionParameters.DEFAULT.buildUpon()
            .setOverrideForType(TrackSelectionOverride(audioGroup, listOf(0)))
            .setOverrideForType(TrackSelectionOverride(textGroup, listOf(0)))
            .setTrackTypeDisabled(C.TRACK_TYPE_TEXT, true)
            .build()
        val reset = StreamAudioChannelTransition.forDifferentLiveChannel(base)
        assertTrue(reset.disabledTrackTypes.contains(C.TRACK_TYPE_TEXT))
        assertTrue(reset.overrides.containsKey(textGroup))
        assertFalse(reset.overrides.containsKey(audioGroup))
    }
}
