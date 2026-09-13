package tv.blofy.player.core.playback

internal object PlaybackFallbackPolicy {
    fun configuredUrl(
        fallbackUrl: String?,
        fallbackAttempted: Boolean,
        attemptedUrls: Set<String>
    ): String? {
        if (fallbackAttempted) return null
        val candidate = fallbackUrl?.trim().orEmpty()
        if (!candidate.startsWith("http://", ignoreCase = true) &&
            !candidate.startsWith("https://", ignoreCase = true)
        ) {
            return null
        }
        return candidate.takeUnless { attemptedUrls.contains(it) }
    }
}

internal class PlaybackFallbackState {
    private var fallbackUrls: List<String> = emptyList()
    private val attemptedUrls = linkedSetOf<String>()

    fun begin(primaryUrl: String, fallbackUrl: String?, fallbackUrls: List<String> = emptyList()) {
        this.fallbackUrls = (fallbackUrls + listOfNotNull(fallbackUrl)).map { it.trim() }.distinct()
        attemptedUrls.clear()
        attemptedUrls += primaryUrl
    }

    fun nextConfiguredUrl(): String? = fallbackUrls.firstNotNullOfOrNull {
        PlaybackFallbackPolicy.configuredUrl(it, false, attemptedUrls)
    }

    fun wasAttempted(url: String): Boolean = url in attemptedUrls

    fun markUrlAttempted(url: String) {
        attemptedUrls += url
    }

    fun markConfiguredUrlAttempted(url: String) {
        attemptedUrls += url
    }
}
