package tv.blofy.player.core.identity

import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrl
import java.io.IOException
import java.util.UUID

/**
 * Per-player opaque routes for TS, VOD and same-origin HLS children.
 * No arbitrary host, cross-origin CDN or redirect is accepted in this QA adapter.
 */
internal class ExternalXtreamMediaRoutes(private val origin: HttpUrl) {
    private val entries = LinkedHashMap<HttpUrl, HttpUrl>(128, .75f, true)
    private val reverse = HashMap<HttpUrl, HttpUrl>()
    private val opaqueOrigin = "https://external-xtream.invalid/".toHttpUrl()
    private val uriAttribute = Regex("""\bURI="([^"]*)"""")

    private fun allowed(url: HttpUrl): Boolean =
        url.scheme == origin.scheme && url.host == origin.host && url.port == origin.port &&
            url.username.isEmpty() && url.password.isEmpty() && url.fragment == null

    @Synchronized fun add(actual: HttpUrl, extension: String = ""): HttpUrl {
        if (!allowed(actual)) throw IOException("External media origin denied")
        reverse[actual]?.let { existing ->
            entries[existing]
            return existing
        }
        val suffix = extension.takeIf { it.matches(Regex("[A-Za-z0-9]{1,8}")) }
            ?.let { ".$it" }.orEmpty()
        val opaque = opaqueOrigin.newBuilder().addPathSegment("__blofy_connect_media__")
            .addPathSegment(UUID.randomUUID().toString() + suffix).build()
        entries[opaque] = actual
        reverse[actual] = opaque
        if (entries.size > MAX_ROUTES) {
            val eldest = entries.entries.iterator()
            val removed = eldest.next()
            reverse.remove(removed.value)
            eldest.remove()
        }
        return opaque
    }

    @Synchronized fun resolve(opaque: HttpUrl): HttpUrl =
        entries[opaque] ?: throw IOException("External media route denied")

    private fun child(base: HttpUrl, value: String): String {
        if (value.isBlank() || value.contains("{\$") || value.startsWith("data:", ignoreCase = true))
            throw IOException("External HLS URI unsupported")
        val actual = base.resolve(value) ?: throw IOException("External HLS URI invalid")
        val extension = actual.pathSegments.lastOrNull()?.substringAfterLast('.', "").orEmpty()
        return add(actual, extension).toString()
    }

    fun rewriteManifest(actual: HttpUrl, body: String): String {
        if (!allowed(actual) || !body.trimStart().startsWith("#EXTM3U"))
            throw IOException("External HLS manifest invalid")
        return body.lineSequence().joinToString("\n") { original ->
            val line = original.trim()
            when {
                line.isEmpty() -> original
                line.startsWith("#") -> uriAttribute.replace(original) { match ->
                    "URI=\"" + child(actual, match.groupValues[1]) + "\""
                }
                else -> child(actual, line)
            }
        } + "\n"
    }

    private companion object {
        const val MAX_ROUTES = 16384
    }
}
