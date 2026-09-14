package tv.blofy.player.core.playback

import androidx.media3.common.TrackSelectionParameters

/** Ephemeral state for releasing decoders while the playback Activity is stopped. */
data class PlaybackResumeState(
    val url: String,
    val positionMs: Long,
    val playWhenReady: Boolean,
    val fallbackUrls: List<String>,
    val trackSelectionParameters: TrackSelectionParameters
)
