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
        // On small/720p TVs a tall static action footer left room for only
        // one channel card. Show the two essential controls by default.
        val compact = listOf(LiveChannelPanelAction.BLOFY_AUDIO, LiveChannelPanelAction.MORE)
        return if (!expanded) compact else compact + listOf(
            LiveChannelPanelAction.FAVORITE, LiveChannelPanelAction.EPG,
            LiveChannelPanelAction.AUDIO_TRACKS, LiveChannelPanelAction.SUBTITLES,
            LiveChannelPanelAction.VIDEO_QUALITY, LiveChannelPanelAction.STREAM_INFO,
            LiveChannelPanelAction.RECONNECT
        )
    }

    fun matchesSearch(channelName: String, query: String): Boolean {
        val needle = ArabicSearchNormalizer.normalize(query.trim())
        return if (query.isBlank()) true
        else if (needle.isEmpty()) channelName.contains(query.trim(), ignoreCase = true)
        else ArabicSearchNormalizer.normalize(channelName).contains(needle)
    }

    /** Existing channel order for ALL; recent tab uses recently watched order. */
    fun <T> orderedByRecent(rows: List<T>, recentIds: List<String>, key: (T) -> String): List<T> {
        val byKey = rows.associateBy(key)
        return recentIds.distinct().mapNotNull(byKey::get)
    }

    /**
     * First keyboard/TV focus stays on the last highlighted or currently playing channel,
     * not the search field. A stale key falls back to the actual playing channel.
     */
    fun initialChannelIndex(keys: List<String>, lastFocusedKey: String?, playingKey: String?): Int {
        if (keys.isEmpty()) return -1
        for (candidate in listOf(lastFocusedKey, playingKey)) {
            if (!candidate.isNullOrBlank()) {
                val index = keys.indexOf(candidate)
                if (index >= 0) return index
            }
        }
        return 0
    }

    /** Scale the joined panel while reserving enough width for remote navigation. */
    fun dimensions(isTv: Boolean, isTablet: Boolean): Pair<Float, Float> = when {
        isTv -> 0.31f to 0.94f
        isTablet -> 0.42f to 0.92f
        else -> 0.82f to 0.92f
    }
}
