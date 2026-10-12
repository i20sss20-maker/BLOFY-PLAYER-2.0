package tv.blofy.player.core.playback

import tv.blofy.player.core.provider.LiveFormat

/**
 * A manifest extension wins over the provider's preferred live format.
 * MPEG-DASH and HLS also apply to VOD and series episodes, not only live TV.
 * Preserve exact stream URLs, including their query parameters.
 */
internal object PlaybackMediaTypePolicy {
    fun shouldHintDash(url: String): Boolean =
        pathWithoutQueryOrFragment(url).endsWith(".mpd", ignoreCase = true)

    fun shouldHintHls(contentKind: String, configuredFormat: LiveFormat, url: String): Boolean {
        val path = pathWithoutQueryOrFragment(url)
        return when {
            path.endsWith(".mpd", ignoreCase = true) -> false
            path.endsWith(".m3u8", ignoreCase = true) -> true
            path.endsWith(".ts", ignoreCase = true) -> false
            else -> (contentKind == "live" || contentKind == "live_preview") && configuredFormat == LiveFormat.HLS
        }
    }

    private fun pathWithoutQueryOrFragment(url: String): String {
        val suffixStart = listOf(url.indexOf('?'), url.indexOf('#')).filter { it >= 0 }.minOrNull()
            ?: url.length
        return url.substring(0, suffixStart)
    }
}
