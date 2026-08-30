package tv.blofy.player.core.url

import tv.blofy.player.core.provider.LiveFormat

object XtreamUrlBuilder {
    fun live(baseUrl: String, username: String, password: String, streamId: String, format: LiveFormat): String =
        "${base(baseUrl)}/live/${segment(username)}/${segment(password)}/${segment(streamId)}.${format.extension}"

    fun movie(baseUrl: String, username: String, password: String, streamId: String, extension: String): String =
        "${base(baseUrl)}/movie/${segment(username)}/${segment(password)}/${segment(streamId)}.${cleanExtension(extension)}"

    fun episode(baseUrl: String, username: String, password: String, episodeId: String, extension: String): String =
        "${base(baseUrl)}/series/${segment(username)}/${segment(password)}/${segment(episodeId)}.${cleanExtension(extension)}"

    private fun base(value: String) = value.trim().trimEnd('/')
    private fun segment(value: String) = value.trim().replace("/", "%2F")
    private fun cleanExtension(value: String) = value.trim().trimStart('.').ifBlank { "mp4" }
}
