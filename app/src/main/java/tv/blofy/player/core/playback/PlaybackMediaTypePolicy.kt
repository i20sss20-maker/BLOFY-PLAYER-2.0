package tv.blofy.player.core.playback

import tv.blofy.player.core.provider.LiveFormat

internal object PlaybackMediaTypePolicy {
    fun shouldHintHls(contentKind: String, configuredFormat: LiveFormat, url: String): Boolean {
        if (contentKind != "live" && contentKind != "live_preview") return false
        val suffixStart = listOf(url.indexOf('?'), url.indexOf('#'))
            .filter { it >= 0 }
            .minOrNull() ?: url.length
        val path = url.substring(0, suffixStart)
        return when {
            path.endsWith(".m3u8", ignoreCase = true) -> true
            path.endsWith(".ts", ignoreCase = true) -> false
            else -> configuredFormat == LiveFormat.HLS
        }
    }
}
