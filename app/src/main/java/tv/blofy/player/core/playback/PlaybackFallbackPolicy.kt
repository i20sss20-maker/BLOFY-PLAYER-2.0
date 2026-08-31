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
    private var fallbackUrl: String? = null
    private var fallbackAttempted = false
    private val attemptedUrls = linkedSetOf<String>()

    fun begin(primaryUrl: String, fallbackUrl: String?) {
        this.fallbackUrl = fallbackUrl
        fallbackAttempted = false
        attemptedUrls.clear()
        attemptedUrls += primaryUrl
    }

    fun nextConfiguredUrl(): String? = PlaybackFallbackPolicy.configuredUrl(
        fallbackUrl = fallbackUrl,
        fallbackAttempted = fallbackAttempted,
        attemptedUrls = attemptedUrls
    )

    fun markUrlAttempted(url: String) {
        attemptedUrls += url
    }

    fun markConfiguredUrlAttempted(url: String) {
        fallbackAttempted = true
        attemptedUrls += url
    }
}
