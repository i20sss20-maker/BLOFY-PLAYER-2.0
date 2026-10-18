package tv.blofy.player.ui.player

/**
 * Only expose provider-supplied, HTTP(S) sources for the same content item.
 * Never infer alternate providers or manufacture links for a movie or episode.
 */
internal data class PlaybackSource(val url: String)

internal object PlaybackSourcePolicy {
    fun availableSources(primaryUrl: String, configuredFallbackUrl: String?): List<PlaybackSource> {
        val sources = mutableListOf(PlaybackSource(primaryUrl))
        val fallback = configuredFallbackUrl?.trim().orEmpty()
        if (fallback.isNotEmpty() &&
            (fallback.startsWith("https://", ignoreCase = true) ||
                fallback.startsWith("http://", ignoreCase = true)) &&
            !primaryUrl.equals(fallback, ignoreCase = true)
        ) {
            sources += PlaybackSource(fallback)
        }
        return sources
    }
}
