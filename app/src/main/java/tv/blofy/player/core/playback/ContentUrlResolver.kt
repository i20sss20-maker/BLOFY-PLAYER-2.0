package tv.blofy.player.core.playback

import tv.blofy.player.core.provider.LiveFormat
import tv.blofy.player.core.provider.ProviderProfile
import tv.blofy.player.core.url.XtreamUrlBuilder
import tv.blofy.player.data.local.EpisodeEntity
import tv.blofy.player.data.local.ProviderEntity
import tv.blofy.player.data.local.StreamEntity

object ContentUrlResolver {
    fun live(provider: ProviderEntity, profile: ProviderProfile, stream: StreamEntity): String {
        return stream.directSource?.takeIf { it.startsWith("http://") || it.startsWith("https://") }
            ?: XtreamUrlBuilder.live(
                provider.baseUrl,
                provider.username,
                provider.password,
                stream.remoteId,
                profile.liveFormat
            )
    }

    fun movie(provider: ProviderEntity, stream: StreamEntity): String {
        return stream.directSource?.takeIf { it.startsWith("http://") || it.startsWith("https://") }
            ?: XtreamUrlBuilder.movie(
                provider.baseUrl,
                provider.username,
                provider.password,
                stream.remoteId,
                stream.extension ?: "mp4"
            )
    }

    fun episode(provider: ProviderEntity, episode: EpisodeEntity): String {
        return episode.directSource?.takeIf { it.startsWith("http://") || it.startsWith("https://") }
            ?: XtreamUrlBuilder.episode(
                provider.baseUrl,
                provider.username,
                provider.password,
                episode.remoteId,
                episode.extension
            )
    }
}
