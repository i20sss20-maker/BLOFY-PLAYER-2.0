package tv.blofy.player.core.playback

import androidx.media3.common.MimeTypes
import java.net.URI

/**
 * Optional, provider-authorized Widevine playback configuration.
 * This does not discover, purchase or bypass licenses. Never persist or log license URLs.
 */
internal object PlaybackDrmPolicy {
    fun validatedLicenseUri(value: String?): String? {
        val raw = value?.trim()?.takeIf { it.isNotEmpty() && it.length <= 4096 } ?: return null
        val uri = runCatching { URI(raw) }.getOrNull() ?: return null
        if (!uri.scheme.equals("https", ignoreCase = true) ||
            uri.host.isNullOrBlank() ||
            uri.rawUserInfo != null ||
            uri.rawFragment != null ||
            uri.port !in -1..65535 ||
            uri.port == 0
        ) return null
        return uri.toString()
    }

    fun canAttachWidevine(mimeTypeHint: String?): Boolean =
        mimeTypeHint == MimeTypes.APPLICATION_MPD || mimeTypeHint == MimeTypes.APPLICATION_M3U8
}
