package tv.blofy.player.ui.library

/**
 * Only user-requested, direct progressive VOD/episode files can be queued.
 * A playback URL is NOT evidence of download rights; UI must require the
 * subscriber to confirm permission before calling the system download queue.
 * HLS/DASH, DRM and live feeds are never converted or captured.
 */
internal object OfflineDownloadPolicy {
    val progressiveFormats = setOf("mp4", "mkv", "webm", "mov", "m4v")
    fun supported(kind: String, url: String, extension: String?, drmProtected: Boolean = false): Boolean {
        if (kind !in setOf("movie", "episode") || drmProtected) return false
        val uri = runCatching { java.net.URI(url) }.getOrNull() ?: return false
        if (uri.scheme?.lowercase() != "https" || uri.host.isNullOrBlank()) return false
        if (uri.userInfo != null || uri.fragment != null) return false
        val ext = extension.orEmpty().trim().removePrefix(".").lowercase()
        val pathExt = uri.path.orEmpty().substringAfterLast('.', "").lowercase()
        return ext in progressiveFormats && pathExt in progressiveFormats &&
            uri.path.orEmpty().contains('/') &&
            !uri.path.orEmpty().contains("/live/", ignoreCase = true)
    }
    fun extension(value: String?): String =
        value.orEmpty().trim().removePrefix(".").lowercase().takeIf { it in progressiveFormats }.orEmpty()
}
