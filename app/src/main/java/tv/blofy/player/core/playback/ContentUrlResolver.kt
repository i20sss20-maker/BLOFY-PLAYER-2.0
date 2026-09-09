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

/** Xtream playback URL policy. Playback engines are intentionally untouched. */
object ContentUrlResolver {
    data class LiveRoute(val primaryUrl: String, val fallbackUrl: String?, val fallbackUrls: List<String> = emptyList())

    private data class RouteContext(
        val provider: ProviderEntity,
        val liveProfile: ProviderProfile? = null,
    )

    private val recentRoutes = ConcurrentHashMap<String, RouteContext>()

    /** Single source of truth used by both Live preview and full-screen playback. */
    fun liveRoute(provider: ProviderEntity, profile: ProviderProfile, stream: StreamEntity): LiveRoute {
        recentRoutes[provider.id] = RouteContext(provider, profile)
        val primary = primaryDirectSource(provider.baseUrl, stream.directSource) ?: canonicalLive(provider, profile, stream)
        val fallback = liveFallbackForPrimary(provider, profile, stream, primary)
        return LiveRoute(primary, fallback, recoveryUrls(provider, profile, stream).filterNot { it == primary })
    }

    /** Ordered routes for one item. Preserve signed paths/queries; never invent a CDN path. */
    fun recoveryUrls(provider: ProviderEntity, profile: ProviderProfile, stream: StreamEntity): List<String> {
        val canonical = when (stream.kind) {
            "live" -> canonicalLive(provider, profile, stream)
            "movie" -> canonicalMovie(provider, stream)
            else -> return emptyList()
        }
        return listOfNotNull(
            primaryDirectSource(provider.baseUrl, stream.directSource),
            ProviderHostResolver.providerOriginFallback(provider.baseUrl, stream.directSource),
            canonical,
            if (stream.kind == "live") alternateLiveFormat(canonical, profile) else null,
        ).distinct()
    }

    fun recoveryUrls(provider: ProviderEntity, episode: EpisodeEntity): List<String> = listOfNotNull(
        primaryDirectSource(provider.baseUrl, episode.directSource),
        ProviderHostResolver.providerOriginFallback(provider.baseUrl, episode.directSource),
        canonicalEpisode(provider, episode),
    ).distinct()

    fun recoveryUrls(stream: StreamEntity): List<String> {
        val context = recentRoutes[stream.providerId] ?: return listOfNotNull(stream.directSource.safeContextFreeFallback())
        val profile = context.liveProfile ?: ProviderProfile(providerKey = context.provider.id)
        return recoveryUrls(context.provider, profile, stream)
    }

    fun recoveryUrls(episode: EpisodeEntity): List<String> {
        val context = recentRoutes[episode.providerId] ?: return listOfNotNull(episode.directSource.safeContextFreeFallback())
        return recoveryUrls(context.provider, episode)
    }

    fun live(provider: ProviderEntity, profile: ProviderProfile, stream: StreamEntity): String =
        liveRoute(provider, profile, stream).primaryUrl

    fun movie(provider: ProviderEntity, stream: StreamEntity): String {
        recentRoutes[provider.id] = RouteContext(provider, recentRoutes[provider.id]?.liveProfile)
        return primaryDirectSource(provider.baseUrl, stream.directSource) ?: canonicalMovie(provider, stream)
    }

    fun episode(provider: ProviderEntity, episode: EpisodeEntity): String {
        recentRoutes[provider.id] = RouteContext(provider, recentRoutes[provider.id]?.liveProfile)
        return primaryDirectSource(provider.baseUrl, episode.directSource) ?: canonicalEpisode(provider, episode)
    }

    /**
     * If a provider gives a public-looking hidden/CDN host, the first fallback preserves the exact
     * direct_source path/query but swaps only the origin to the configured provider host. This is
     * important for panels whose hidden hostname is unreachable from some TV networks. If that
     * route is not applicable, fall back to the canonical Xtream URL.
     */
    fun liveFallback(provider: ProviderEntity, profile: ProviderProfile, stream: StreamEntity): String? {
        recentRoutes[provider.id] = RouteContext(provider, profile)
        val primary = primaryDirectSource(provider.baseUrl, stream.directSource) ?: canonicalLive(provider, profile, stream)
        return liveFallbackForPrimary(provider, profile, stream, primary)
    }

    private fun liveFallbackForPrimary(
        provider: ProviderEntity,
        profile: ProviderProfile,
        stream: StreamEntity,
        primary: String,
    ): String? {
        val source = stream.directSource
        if (source.validHttpUrl() == null) return null
        val canonical = canonicalLive(provider, profile, stream).takeUnless { it == primary }
        if (canonical != null) return canonical
        return ProviderHostResolver.providerOriginFallback(provider.baseUrl, source)
            ?.takeUnless { it == primary }
    }

    fun movieFallback(provider: ProviderEntity, stream: StreamEntity): String? {
        val primary = primaryDirectSource(provider.baseUrl, stream.directSource) ?: return null
        val canonical = canonicalMovie(provider, stream).takeUnless { it == primary }
        if (canonical != null) return canonical
        return ProviderHostResolver.providerOriginFallback(provider.baseUrl, stream.directSource)
            ?.takeUnless { it == primary }
    }

    fun episodeFallback(provider: ProviderEntity, episode: EpisodeEntity): String? {
        val primary = primaryDirectSource(provider.baseUrl, episode.directSource) ?: return null
        val canonical = canonicalEpisode(provider, episode).takeUnless { it == primary }
        if (canonical != null) return canonical
        return ProviderHostResolver.providerOriginFallback(provider.baseUrl, episode.directSource)
            ?.takeUnless { it == primary }
    }

    fun directFallback(provider: ProviderEntity, stream: StreamEntity): String? = when (stream.kind) {
        "live" -> recentRoutes[provider.id]?.liveProfile?.let { liveFallback(provider, it, stream) }
        "movie" -> movieFallback(provider, stream)
        else -> null
    }

    fun directFallback(provider: ProviderEntity, episode: EpisodeEntity): String? =
        episodeFallback(provider, episode)

    fun directFallback(stream: StreamEntity): String? {
        val route = recentRoutes[stream.providerId] ?: return stream.directSource.safeContextFreeFallback()
        val primary = primaryDirectSource(route.provider.baseUrl, stream.directSource) ?: return null
        val origin = ProviderHostResolver.providerOriginFallback(route.provider.baseUrl, stream.directSource)
            ?.takeUnless { it == primary }
        if (origin != null) return origin
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
        val primary = primaryDirectSource(route.provider.baseUrl, episode.directSource) ?: return null
        val origin = ProviderHostResolver.providerOriginFallback(route.provider.baseUrl, episode.directSource)
            ?.takeUnless { it == primary }
        return origin ?: canonicalEpisode(route.provider, episode).takeUnless { it == primary }
    }

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

    private fun String?.validHttpUrl(): String? = this?.trim()?.takeIf {
        it.startsWith("http://", ignoreCase = true) || it.startsWith("https://", ignoreCase = true)
    }
}
