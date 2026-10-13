package tv.blofy.player.core.playback

import androidx.media3.common.MimeTypes
import tv.blofy.player.core.provider.LiveFormat
import java.net.URI
import java.util.Locale

/** Only hint a format when the URL or explicit provider selection justifies it. */
internal object PlaybackMediaTypePolicy {
    fun mimeTypeHint(contentKind: String, configuredFormat: LiveFormat, url: String): String? {
        val path = runCatching { URI(url).path }.getOrNull()
            ?.lowercase(Locale.ROOT) ?: return null
        return when {
            path.endsWith(".mpd") -> MimeTypes.APPLICATION_MPD
            path.endsWith(".m3u8") -> MimeTypes.APPLICATION_M3U8
            // Never label an explicitly named transport/container as an HLS playlist.
            listOf(".ts", ".mp4", ".mkv", ".webm", ".avi", ".mov").any { path.endsWith(it) } -> null
            (contentKind == "live" || contentKind == "live_preview") && configuredFormat == LiveFormat.HLS ->
                MimeTypes.APPLICATION_M3U8
            else -> null
        }
    }

    fun shouldHintHls(contentKind: String, configuredFormat: LiveFormat, url: String): Boolean =
        mimeTypeHint(contentKind, configuredFormat, url) == MimeTypes.APPLICATION_M3U8
}
