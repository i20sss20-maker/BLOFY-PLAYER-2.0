package tv.blofy.player.core.playback

import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import tv.blofy.player.core.provider.ProviderProfile
import tv.blofy.player.core.provider.ProviderKind
import tv.blofy.player.core.url.XtreamUrlBuilder
import tv.blofy.player.data.local.EpisodeEntity
import tv.blofy.player.data.local.ProviderEntity
import tv.blofy.player.data.local.StreamEntity
import java.net.URI
import java.util.concurrent.ConcurrentHashMap

/** Xtream-only playback URL policy for rc07.14. */
object ContentUrlResolver {
    /**
     * A few legacy screens still ask for a context-free fallback after resolving the primary URL.
     * Keep only the last provider route in memory so those callers can receive the canonical panel
     * URL instead of accidentally passing direct_source twice. No persistence or network work occurs.
     */
    private data class RouteContext(
        val provider: ProviderEntity,
        val liveProfile: ProviderProfile? = null,
    )

    private val recentRoutes = ConcurrentHashMap<String, RouteContext>()

    fun live(provider: ProviderEntity, profile: ProviderProfile, stream: StreamEntity): String {
        recentRoutes[provider.id] = RouteContext(provider, profile)
        return primaryDirectSource(provider.baseUrl, stream.directSource) ?: canonicalLive(provider, profile, stream)
    }

    fun movie(provider: ProviderEntity, stream: StreamEntity): String {
        recentRoutes[provider.id] = RouteContext(provider, recentRoutes[provider.id]?.liveProfile)
        return primaryDirectSource(provider.baseUrl, stream.directSource) ?: canonicalMovie(provider, stream)
    }

    fun episode(provider: ProviderEntity, episode: EpisodeEntity): String {
        recentRoutes[provider.id] = RouteContext(provider, recentRoutes[provider.id]?.liveProfile)
        return primaryDirectSource(provider.baseUrl, episode.directSource) ?: canonicalEpisode(provider, episode)
    }

    /**
     * When direct_source is the primary route, retain the canonical panel route as a distinct
     * configured fallback. If direct_source is absent, the canonical route is already primary.
     */
    fun liveFallback(provider: ProviderEntity, profile: ProviderProfile, stream: StreamEntity): String? {
        val primary = primaryDirectSource(provider.baseUrl, stream.directSource) ?: return null
        return canonicalLive(provider, profile, stream).takeUnless { it == primary }
    }

    fun movieFallback(provider: ProviderEntity, stream: StreamEntity): String? {
        val primary = primaryDirectSource(provider.baseUrl, stream.directSource) ?: return null
        return canonicalMovie(provider, stream).takeUnless { it == primary }
    }

    fun episodeFallback(provider: ProviderEntity, episode: EpisodeEntity): String? {
        val primary = primaryDirectSource(provider.baseUrl, episode.directSource) ?: return null
        return canonicalEpisode(provider, episode).takeUnless { it == primary }
    }

    /**
     * Compatibility overloads are fallback APIs. The primary direct_source route is selected only
     * by live/movie/episode above. This keeps older UI call sites safe without changing Media3,
     * FFmpeg, the playback session, or engine-selection policy.
     */
    fun directFallback(provider: ProviderEntity, stream: StreamEntity): String? = when (stream.kind) {
        "live" -> recentRoutes[provider.id]?.liveProfile?.let { liveFallback(provider, it, stream) }
        "movie" -> movieFallback(provider, stream)
        else -> null
    }

    fun directFallback(provider: ProviderEntity, episode: EpisodeEntity): String? =
        episodeFallback(provider, episode)

    /**
     * Legacy context-free callers normally invoke this immediately after live/movie/episode. Use
     * the remembered provider route to return a genuinely different canonical fallback. With no
     * route context (for example isolated tests/old callers), preserve the historical safe behavior.
     */
    fun directFallback(stream: StreamEntity): String? {
        val route = recentRoutes[stream.providerId] ?: return stream.directSource.safeContextFreeFallback()
        val primary = primaryDirectSource(route.provider.baseUrl, stream.directSource)
            ?: return null
        val canonical = when (stream.kind) {
            "live" -> route.liveProfile?.let { canonicalLive(route.provider, it, stream) }
            "movie" -> canonicalMovie(route.provider, stream)
            else -> null
        }
        return canonical?.takeUnless { it == primary }
            ?: stream.directSource.safeContextFreeFallback()?.takeUnless { it == primary }
    }

    fun directFallback(episode: EpisodeEntity): String? {
        val route = recentRoutes[episode.providerId] ?: return episode.directSource.safeContextFreeFallback()
        val primary = primaryDirectSource(route.provider.baseUrl, episode.directSource)
            ?: return null
        return canonicalEpisode(route.provider, episode).takeUnless { it == primary }
    }

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

    private fun primaryDirectSource(providerBaseUrl: String, directSource: String?): String? {
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
