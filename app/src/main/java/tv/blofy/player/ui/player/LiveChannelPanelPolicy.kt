package tv.blofy.player.ui.player

import tv.blofy.player.core.text.ArabicSearchNormalizer

/** All controls share one joined live-TV sidebar; no second player surface. */
internal enum class LiveChannelPanelAction {
    BLOFY_AUDIO, FAVORITE, EPG, MORE,
    AUDIO_TRACKS, SUBTITLES, VIDEO_QUALITY, STREAM_INFO, RECONNECT
}
internal enum class LiveChannelTab { ALL, FAVORITES, RECENT }

internal object LiveChannelPanelPolicy {
    fun actions(streamCodeOnly: Boolean, expanded: Boolean = false): List<LiveChannelPanelAction> {
        if (!streamCodeOnly) return emptyList()
        val main = listOf(LiveChannelPanelAction.BLOFY_AUDIO, LiveChannelPanelAction.FAVORITE,
            LiveChannelPanelAction.EPG, LiveChannelPanelAction.MORE)
        return if (!expanded) main else main + listOf(LiveChannelPanelAction.AUDIO_TRACKS,
            LiveChannelPanelAction.SUBTITLES, LiveChannelPanelAction.VIDEO_QUALITY,
            LiveChannelPanelAction.STREAM_INFO, LiveChannelPanelAction.RECONNECT)
    }

    fun matchesSearch(channelName: String, query: String): Boolean {
        val needle = ArabicSearchNormalizer.normalize(query.trim())
        return needle.isEmpty() || ArabicSearchNormalizer.normalize(channelName).contains(needle)
    }

    /** Existing channel order for ALL; recent tab uses recently watched order. */
    fun <T> orderedByRecent(rows: List<T>, recentIds: List<String>, key: (T) -> String): List<T> {
        val byKey = rows.associateBy(key)
        return recentIds.distinct().mapNotNull(byKey::get)
    }

    /** Scale the joined panel while reserving enough width for remote navigation. */
    fun dimensions(isTv: Boolean, isTablet: Boolean): Pair<Float, Float> = when {
        isTv -> 0.30f to 0.84f
        isTablet -> 0.42f to 0.84f
        else -> 0.82f to 0.90f
    }
}
