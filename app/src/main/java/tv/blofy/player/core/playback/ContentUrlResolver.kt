package tv.blofy.player.core.playback

import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import tv.blofy.player.core.provider.ProviderProfile
import tv.blofy.player.core.provider.ProviderKind
import tv.blofy.player.core.url.XtreamUrlBuilder
import tv.blofy.player.data.local.EpisodeEntity
import tv.blofy.player.data.local.ProviderEntity
import tv.blofy.player.data.local.StreamEntity
import java.net.URI

/** Exact URL first. M3U keeps its supplied path/query while clearly-internal hosts are repaired. */
object ContentUrlResolver {
    fun live(provider: ProviderEntity, profile: ProviderProfile, stream: StreamEntity): String {
        if (provider.providerType.equals("m3u", true)) {
            return ProviderHostResolver.resolve(provider.baseUrl, stream.directSource).validHttpUrl()
                ?: error("Missing M3U live URL")
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
            return ProviderHostResolver.resolve(provider.baseUrl, stream.directSource).validHttpUrl()
                ?: error("Missing M3U movie URL")
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
            return ProviderHostResolver.resolve(provider.baseUrl, episode.directSource).validHttpUrl()
                ?: error("Missing M3U episode URL")
        }
        return XtreamUrlBuilder.episode(
            provider.baseUrl,
            provider.username,
            provider.password,
            episode.remoteId,
            episode.extension
        )
    }

    fun directFallback(provider: ProviderEntity, stream: StreamEntity): String? =
        ProviderHostResolver.resolve(provider.baseUrl, stream.directSource).validHttpUrl()

    fun directFallback(provider: ProviderEntity, episode: EpisodeEntity): String? =
        ProviderHostResolver.resolve(provider.baseUrl, episode.directSource).validHttpUrl()

    /**
     * Legacy callers may not have provider context. Never hand a clearly-internal direct_source to
     * the player as a fallback: the primary Xtream URL remains the safe public-provider path, while
     * M3U primary URLs are already repaired by the provider-aware resolver above.
     */
    fun directFallback(stream: StreamEntity): String? = stream.directSource.safeContextFreeFallback()
    fun directFallback(episode: EpisodeEntity): String? = episode.directSource.safeContextFreeFallback()

    /**
     * Xtream installations do not all accept the same live output suffix. If the
     * configured TS/HLS endpoint fails, try the other standard endpoint inside
     * BLOFY before reporting a terminal playback failure.
     */
    fun alternateLiveFormat(url: String, profile: ProviderProfile): String? {
        if (profile.providerKind != ProviderKind.XTREAM) return null

        val suffixStart = listOf(url.indexOf('?'), url.indexOf('#'))
            .filter { it >= 0 }
            .minOrNull() ?: url.length
        val path = url.substring(0, suffixStart)
        val suffix = url.substring(suffixStart)
        if (!path.isXtreamLiveUrl()) return null
        val alternatePath = when {
            path.endsWith(".m3u8", ignoreCase = true) -> path.dropLast(".m3u8".length) + ".ts"
            path.endsWith(".ts", ignoreCase = true) -> path.dropLast(".ts".length) + ".m3u8"
            else -> return null
        }
        return alternatePath + suffix
    }

    private fun String.isXtreamLiveUrl(): Boolean {
        val uri = runCatching { URI(this) }.getOrNull() ?: return false
        if (uri.scheme?.lowercase() !in setOf("http", "https") || uri.rawAuthority.isNullOrBlank()) return false
        val segments = uri.rawPath.orEmpty().split('/').filter { it.isNotBlank() }
        val liveIndex = segments.indexOfLast { it.equals("live", ignoreCase = true) }
        return liveIndex >= 0 && segments.size == liveIndex + 4 &&
            segments.subList(liveIndex + 1, segments.size).all { it.isNotBlank() }
    }

    private fun String?.safeContextFreeFallback(): String? {
        val value = validHttpUrl() ?: return null
        val host = value.toHttpUrlOrNull()?.host ?: return null
        return value.takeUnless { ProviderHostResolver.isClearlyInternal(host) }
    }

    private fun String?.validHttpUrl(): String? = this?.takeIf {
        it.startsWith("http://", ignoreCase = true) || it.startsWith("https://", ignoreCase = true)
    }
}
