package tv.blofy.player.core.playback

import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import tv.blofy.player.core.provider.ProviderProfile
import tv.blofy.player.core.provider.ProviderKind
import tv.blofy.player.core.url.XtreamUrlBuilder
import tv.blofy.player.data.local.EpisodeEntity
import tv.blofy.player.data.local.ProviderEntity
import tv.blofy.player.data.local.StreamEntity
import java.net.URI

/** Xtream-only playback URL policy for rc07.14. */
object ContentUrlResolver {
    fun live(provider: ProviderEntity, profile: ProviderProfile, stream: StreamEntity): String =
        directFallback(provider, stream) ?: canonicalLive(provider, profile, stream)

    fun movie(provider: ProviderEntity, stream: StreamEntity): String =
        directFallback(provider, stream) ?: canonicalMovie(provider, stream)

    fun episode(provider: ProviderEntity, episode: EpisodeEntity): String =
        directFallback(provider, episode) ?: canonicalEpisode(provider, episode)

    /**
     * When direct_source is the primary route, retain the canonical panel route as a distinct
     * configured fallback. If direct_source is absent, the canonical route is already primary.
     */
    fun liveFallback(provider: ProviderEntity, profile: ProviderProfile, stream: StreamEntity): String? =
        canonicalLive(provider, profile, stream).takeIf { directFallback(provider, stream) != null }

    fun movieFallback(provider: ProviderEntity, stream: StreamEntity): String? =
        canonicalMovie(provider, stream).takeIf { directFallback(provider, stream) != null }

    fun episodeFallback(provider: ProviderEntity, episode: EpisodeEntity): String? =
        canonicalEpisode(provider, episode).takeIf { directFallback(provider, episode) != null }

    /**
     * Prefer Xtream's provider-supplied direct_source when available. Public alternate hosts are
     * frequently the real playback/CDN route (the hidden-host case). Only clearly local/private
     * origins are repaired to the provider origin.
     */
    fun directFallback(provider: ProviderEntity, stream: StreamEntity): String? =
        providerAwareFallback(provider.baseUrl, stream.directSource)

    fun directFallback(provider: ProviderEntity, episode: EpisodeEntity): String? =
        providerAwareFallback(provider.baseUrl, episode.directSource)

    /** Legacy context-free callers keep public direct_source values and reject internal hosts. */
    fun directFallback(stream: StreamEntity): String? = stream.directSource.safeContextFreeFallback()
    fun directFallback(episode: EpisodeEntity): String? = episode.directSource.safeContextFreeFallback()

    /**
     * Xtream installations do not all accept the same live output suffix. If the configured
     * TS/HLS endpoint fails, try the other standard endpoint inside BLOFY before terminal error.
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

    private fun canonicalLive(provider: ProviderEntity, profile: ProviderProfile, stream: StreamEntity): String =
        XtreamUrlBuilder.live(
            provider.baseUrl,
            provider.username,
            provider.password,
            stream.remoteId,
            profile.liveFormat
        )

    private fun canonicalMovie(provider: ProviderEntity, stream: StreamEntity): String =
        XtreamUrlBuilder.movie(
            provider.baseUrl,
            provider.username,
            provider.password,
            stream.remoteId,
            stream.extension ?: "mp4"
        )

    private fun canonicalEpisode(provider: ProviderEntity, episode: EpisodeEntity): String =
        XtreamUrlBuilder.episode(
            provider.baseUrl,
            provider.username,
            provider.password,
            episode.remoteId,
            episode.extension
        )

    private fun providerAwareFallback(providerBaseUrl: String, directSource: String?): String? {
        val value = directSource.validHttpUrl() ?: return null
        return ProviderHostResolver.resolve(providerBaseUrl, value).validHttpUrl()
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
