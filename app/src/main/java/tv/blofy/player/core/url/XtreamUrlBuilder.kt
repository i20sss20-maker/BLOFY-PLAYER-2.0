package tv.blofy.player.core.url

import tv.blofy.player.core.provider.LiveFormat
import java.net.URLEncoder
import java.nio.charset.StandardCharsets

object XtreamUrlBuilder {
    fun live(baseUrl: String, username: String, password: String, streamId: String, format: LiveFormat): String =
        "${base(baseUrl)}/live/${segment(username)}/${segment(password)}/${segment(streamId)}.${format.extension}"

    fun movie(baseUrl: String, username: String, password: String, streamId: String, extension: String): String =
        "${base(baseUrl)}/movie/${segment(username)}/${segment(password)}/${segment(streamId)}.${cleanExtension(extension)}"

    fun episode(baseUrl: String, username: String, password: String, episodeId: String, extension: String): String =
        "${base(baseUrl)}/series/${segment(username)}/${segment(password)}/${segment(episodeId)}.${cleanExtension(extension)}"

    private fun base(value: String) = value.trim().trimEnd('/')
    // Xtream user names and passwords may contain ?, #, %, spaces or Unicode.
    // Encode each URL segment rather than treating credentials as literal URI syntax.
    private fun segment(value: String): String =
        URLEncoder.encode(value.trim(), StandardCharsets.UTF_8.name()).replace("+", "%20")

    private fun cleanExtension(value: String): String =
        value.trim().trimStart('.').takeIf { it.matches(Regex("[A-Za-z0-9]{2,6}")) } ?: "mp4"
}
