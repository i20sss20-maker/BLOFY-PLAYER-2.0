package tv.blofy.player.ui.player

import androidx.annotation.OptIn
import androidx.media3.common.util.UnstableApi
import androidx.media3.common.C
import androidx.media3.common.MimeTypes
import androidx.media3.common.Tracks

/**
 * Opt-in-only same-stream AAC alternative. This is not an automatic retry,
 * codec transcode or new upstream connection. It must never choose a Media3
 * unsupported format or replace an already selected AAC track.
 */
@OptIn(markerClass = [UnstableApi::class])
internal object StreamAacTrackChoice {
    data class Candidate(val group: Tracks.Group, val index: Int)

    fun available(tracks: Tracks): Candidate? {
        val audio = tracks.groups.filter { it.type == C.TRACK_TYPE_AUDIO }
        if (audio.any { group ->
                (0 until group.length).any { index ->
                    group.isTrackSelected(index) &&
                        group.isTrackSupported(index) &&
                        group.getTrackFormat(index).sampleMimeType == MimeTypes.AUDIO_AAC
                }
            }) return null
        for (group in audio) {
            for (index in 0 until group.length) {
                if (group.isTrackSupported(index) && !group.isTrackSelected(index) &&
                    group.getTrackFormat(index).sampleMimeType == MimeTypes.AUDIO_AAC
                ) {
                    return Candidate(group, index)
                }
            }
        }
        return null
    }
}
