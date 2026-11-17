package tv.blofy.player.ui.player

import androidx.annotation.OptIn
import androidx.media3.common.C
import androidx.media3.common.TrackSelectionParameters
import androidx.media3.common.util.UnstableApi

/**
 * Protect a new Live channel from the previous channel's audio-track override.
 * No new media request, codec coercion or playback restart is performed here.
 *
 * Keep user preferences for audio language, text tracks, video quality, etc.
 * A manual AAC/AC3 override belongs to its original TrackGroup, not to every
 * subsequently selected channel in the same PlayerActivity.
 */
@OptIn(markerClass = [UnstableApi::class])
internal object StreamAudioChannelTransition {
    fun hasManualAudioOverride(parameters: TrackSelectionParameters): Boolean =
        parameters.overrides.values.any {
            it.trackGroup.type == C.TRACK_TYPE_AUDIO
        }

    fun forDifferentLiveChannel(parameters: TrackSelectionParameters): TrackSelectionParameters =
        parameters.buildUpon()
            .clearOverridesOfType(C.TRACK_TYPE_AUDIO)
            .setTrackTypeDisabled(C.TRACK_TYPE_AUDIO, false)
            .build()
}
