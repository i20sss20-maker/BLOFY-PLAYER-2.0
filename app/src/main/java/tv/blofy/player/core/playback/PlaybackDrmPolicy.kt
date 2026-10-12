package tv.blofy.player.core.playback

import java.net.URI

/**
 * Opt-in Widevine licensing for content for which the viewer has valid playback rights.
 * No keys, cookies or tokens are inferred, stored or shared with an upstream proxy.
 */
internal object PlaybackDrmPolicy {
    fun authorizedWidevineLicenseUrl(rawUrl: String?): String? {
        val url = rawUrl?.trim()?.takeIf { it.isNotBlank() } ?: return null
        val uri = runCatching { URI(url) }.getOrNull() ?: return null
        if (!uri.scheme.equals("https", ignoreCase = true)) return null
        if (uri.host.isNullOrBlank() || uri.rawUserInfo != null || uri.rawFragment != null) return null
        return url
    }
}
