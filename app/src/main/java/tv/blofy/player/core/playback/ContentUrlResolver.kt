package tv.blofy.player.core.playback

import tv.blofy.player.core.provider.ProviderProfile
import tv.blofy.player.core.url.XtreamUrlBuilder
import tv.blofy.player.data.local.EpisodeEntity
import tv.blofy.player.data.local.ProviderEntity
import tv.blofy.player.data.local.StreamEntity

/** Exact URL first. M3U keeps its supplied URL; Xtream uses exact type-specific builders. */
object ContentUrlResolver {
    fun live(provider: ProviderEntity, profile: ProviderProfile, stream: StreamEntity): String {
        if (provider.providerType.equals("m3u", true)) {
            return stream.directSource.validHttpUrl() ?: error("Missing M3U live URL")
        }
        return XtreamUrlBuilder.live(
            provider.baseUrl,
            provider.username,
            provider.password,
            stream.remoteId,
            profile.liveFormat
        )
    }

    fun movie(provider: ProviderEntity, stream: StreamEntity): String {
        if (provider.providerType.equals("m3u", true)) {
            return stream.directSource.validHttpUrl() ?: error("Missing M3U movie URL")
        }
        return XtreamUrlBuilder.movie(
            provider.baseUrl,
            provider.username,
            provider.password,
            stream.remoteId,
            stream.extension ?: "mp4"
        )
    }

    fun episode(provider: ProviderEntity, episode: EpisodeEntity): String {
        if (provider.providerType.equals("m3u", true)) {
            return episode.directSource.validHttpUrl() ?: error("Missing M3U episode URL")
        }
        return XtreamUrlBuilder.episode(
            provider.baseUrl,
            provider.username,
            provider.password,
            episode.remoteId,
            episode.extension
        )
    }

    fun directFallback(stream: StreamEntity): String? = stream.directSource.validHttpUrl()
    fun directFallback(episode: EpisodeEntity): String? = episode.directSource.validHttpUrl()

    private fun String?.validHttpUrl(): String? = this?.takeIf {
        it.startsWith("http://", ignoreCase = true) || it.startsWith("https://", ignoreCase = true)
    }
}
