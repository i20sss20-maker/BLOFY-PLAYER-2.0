package tv.blofy.player.core.playback

import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import tv.blofy.player.core.provider.ProviderProfile
import tv.blofy.player.core.provider.ProviderKind
import tv.blofy.player.core.url.XtreamUrlBuilder
import tv.blofy.player.data.local.EpisodeEntity
import tv.blofy.player.data.local.ProviderEntity
import tv.blofy.player.data.local.StreamEntity
import java.net.URI

/** Xtream-only playback URL policy for rc07.12. */
object ContentUrlResolver {
    fun live(provider: ProviderEntity, profile: ProviderProfile, stream: StreamEntity): String =
        XtreamUrlBuilder.live(
            provider.baseUrl,
            provider.username,
            provider.password,
            stream.remoteId,
            profile.liveFormat
        )

    fun movie(provider: ProviderEntity, stream: StreamEntity): String =
        XtreamUrlBuilder.movie(
            provider.baseUrl,
            provider.username,
            provider.password,
            stream.remoteId,
            stream.extension ?: "mp4"
        )

    fun episode(provider: ProviderEntity, episode: EpisodeEntity): String =
        XtreamUrlBuilder.episode(
            provider.baseUrl,
            provider.username,
            provider.password,
            episode.remoteId,
            episode.extension
        )

    /**
     * direct_source is secondary to the canonical Xtream URL. When its host differs from the
     * provider (including public-looking hidden hosts), use the provider's full origin with the
     * direct media path. Clearly internal direct sources are repaired the same way.
     */
    fun directFallback(provider: ProviderEntity, stream: StreamEntity): String? =
        providerAwareFallback(provider.baseUrl, stream.directSource)

    fun directFallback(provider: ProviderEntity, episode: EpisodeEntity): String? =
        providerAwareFallback(provider.baseUrl, episode.directSource)

    /** Legacy context-free callers never receive a clearly-internal URL. */
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

    private fun providerAwareFallback(providerBaseUrl: String, directSource: String?): String? {
        val value = directSource.validHttpUrl() ?: return null
        return ProviderHostResolver.providerOriginFallback(providerBaseUrl, value)
            ?: ProviderHostResolver.resolve(providerBaseUrl, value).validHttpUrl()
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
