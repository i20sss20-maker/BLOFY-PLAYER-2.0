package tv.blofy.player.core.identity

import android.content.Context
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.OkHttpClient
import java.io.IOException

/**
 * Native STREAM player routes never contain provider credentials. The root URI
 * is stable across process recreation; HLS children are isolated to one client.
 */
internal object NativeExternalMediaTransport {
    private val providerPattern = Regex("external-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")
    private val mediaPattern = Regex("([0-9]{1,15})\\.([a-zA-Z0-9]{1,8})")
    private val origin = "https://external-xtream.invalid/".toHttpUrl()
    private val kinds = mapOf(
        "live" to ExternalStreamConnectCatalog.Kind.LIVE,
        "movie" to ExternalStreamConnectCatalog.Kind.MOVIE,
        "series" to ExternalStreamConnectCatalog.Kind.EPISODE
    )

    fun isExternal(providerId: String): Boolean = providerPattern.matches(providerId)

    fun route(providerId: String, kind: String, id: String, extension: String): String {
        require(isExternal(providerId) && ExternalStreamConnectCatalog.safeId(id))
        val type = requireNotNull(kinds[kind])
        val ext = extension.lowercase()
        require(if (kind == "live") ext in setOf("ts", "m3u8")
            else ExternalStreamConnectCatalog.safeExtension(type, ext) == ext)
        return origin.newBuilder().addPathSegment("native").addPathSegment(providerId)
            .addPathSegment(kind).addPathSegment("$id.$ext").build().toString()
    }

    internal fun resolveRoot(url: HttpUrl, providerId: String, credentials: ExternalStreamConnectClient.Credentials): HttpUrl {
        if (url.scheme != "https" || url.host != origin.host || url.port != origin.port ||
            url.username.isNotEmpty() || url.password.isNotEmpty() || url.query != null || url.fragment != null)
            throw IOException("External native route denied")
        val parts = url.pathSegments
        if (parts.size != 4 || parts[0] != "native" || parts[1] != providerId || !isExternal(providerId))
            throw IOException("External native route denied")
        val kind = kinds[parts[2]] ?: throw IOException("External native kind denied")
        val match = mediaPattern.matchEntire(parts[3]) ?: throw IOException("External native item denied")
        val id = match.groupValues[1]
        val ext = match.groupValues[2].lowercase()
        try {
            // Validate canonical format before constructing the secret-bearing request.
            route(providerId, parts[2], id, ext)
            val item = ExternalStreamConnectCatalog.Item(id, "", kind, ext)
            val canonical = ExternalStreamConnectCatalog.mediaUrl(credentials, item)
            return if (kind == ExternalStreamConnectCatalog.Kind.LIVE && ext == "m3u8")
                canonical.newBuilder().setPathSegment(canonical.pathSegments.lastIndex, "$id.m3u8").build()
            else canonical
        } catch (_: IllegalArgumentException) {
            throw IOException("External native item denied")
        }
    }

    fun client(context: Context, providerId: String): OkHttpClient {
        val profile = ExternalStreamConnectStore.loadStaged(context.applicationContext)
        if (!NativeExternalCatalogSession.qaEnabled(context) || StreamCodeSession.isClaimed(context) ||
            profile == null || profile.providerId != providerId || !isExternal(providerId)) {
            return OkHttpClient.Builder().addInterceptor {
                throw IOException("External subscription unavailable")
            }.build()
        }
        val credentials = profile.credentials
        val children = ExternalXtreamMediaRoutes(credentials.host, providerDirectedCdn = true)
        return ExternalStreamConnectCatalog.guardedMediaClient(children) { url ->
            if (url.pathSegments.firstOrNull() == "native")
                resolveRoot(url, providerId, credentials)
            else children.resolve(url)
        }
    }
}
