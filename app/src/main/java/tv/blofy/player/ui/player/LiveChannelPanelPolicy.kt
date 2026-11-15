package tv.blofy.player.ui.player

/**
 * A single vertical action stack attached to the bottom of the live-channel browser.
 * The panel and stream share one window; button clicks open existing trusted playback
 * controls without creating a second player or changing the playing channel.
 */
internal enum class LiveChannelPanelAction {
    BLOFY_AUDIO, AUDIO_TRACKS, SUBTITLES, VIDEO_QUALITY, FAVORITE
}

internal object LiveChannelPanelPolicy {
    fun actions(streamCodeOnly: Boolean): List<LiveChannelPanelAction> =
        if (streamCodeOnly) listOf(
            LiveChannelPanelAction.BLOFY_AUDIO,
            LiveChannelPanelAction.AUDIO_TRACKS,
            LiveChannelPanelAction.SUBTITLES,
            LiveChannelPanelAction.VIDEO_QUALITY,
            LiveChannelPanelAction.FAVORITE
        ) else emptyList()

    /** Scale the joined panel to screen size while keeping room for channel rows. */
    fun dimensions(isTv: Boolean, isTablet: Boolean): Pair<Float, Float> = when {
        isTv -> 0.30f to 0.84f
        isTablet -> 0.42f to 0.84f
        else -> 0.82f to 0.90f
    }
}
