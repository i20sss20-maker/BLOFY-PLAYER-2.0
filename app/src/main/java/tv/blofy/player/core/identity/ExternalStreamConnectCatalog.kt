package tv.blofy.player.core.identity

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.HttpUrl
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.ResponseBody.Companion.toResponseBody
import org.json.JSONArray
import org.json.JSONObject
import tv.blofy.player.core.network.awaitResponse
import java.io.IOException
import java.util.concurrent.TimeUnit

/** Explicitly scoped, direct Xtream catalog for the isolated CONNECT QA build.
 * Provider URLs, poster URLs and direct_source are intentionally not consumed.
 */
object ExternalStreamConnectCatalog {
    enum class Kind(val action: String, val path: String, val idField: String) {
        LIVE("get_live_streams","live","stream_id"),
        MOVIE("get_vod_streams","movie","stream_id"),
        SERIES("get_series","series","series_id"),
        EPISODE("get_series_info","series","id")
    }
    data class Item(val id: String, val title: String, val kind: Kind, val extension: String)
    private val idPattern = Regex("[0-9]{1,15}")
    private val formats = setOf("mp4","mkv","ts","avi","mov","webm","m4v")
    private const val MAX_BODY = 8L * 1024 * 1024
    private const val MAX_ITEMS = 20000

    internal fun safeId(value: String): Boolean = idPattern.matches(value)
    internal fun safeExtension(kind: Kind, value: String): String? =
        if (kind == Kind.LIVE) "ts" else value.lowercase().takeIf { it in formats }
    private fun title(value: String) =
        value.filter { it.code >= 32 && it.code != 127 }.take(160).ifBlank { "بدون عنوان" }

    private val metadataClient = ExternalStreamConnectVerifier.directClient.newBuilder()
        .readTimeout(40, TimeUnit.SECONDS).callTimeout(60, TimeUnit.SECONDS).build()

    private suspend fun read(credentials: ExternalStreamConnectClient.Credentials,
        kind: Kind, seriesId: String? = null): String = withContext(Dispatchers.IO) {
        val host = ExternalStreamConnectClient.parseHost(credentials.host.toString())
            ?: error("عنوان المزود غير صالح")
        val builder = host.newBuilder().addPathSegment("player_api.php")
            .addQueryParameter("username",credentials.username)
            .addQueryParameter("password",credentials.password)
            .addQueryParameter("action",kind.action)
        if (kind == Kind.EPISODE) {
            require(seriesId != null && safeId(seriesId)) { "معرف المسلسل غير صالح" }
            builder.addQueryParameter("series_id",seriesId)
        }
        val request = Request.Builder().url(builder.build()).header("Accept","application/json")
            .header("Cache-Control","no-store").build()
        metadataClient.newCall(request).awaitResponse().use { response ->
            check(response.isSuccessful) { "تعذر جلب المحتوى من المزود" }
            val source = response.body?.source() ?: error("استجابة غير مكتملة")
            source.request(MAX_BODY+1)
            check(source.buffer.size <= MAX_BODY) { "القائمة تتجاوز حد النسخة التجريبية" }
            source.readUtf8()
        }
    }

    private fun row(obj: JSONObject, kind: Kind): Item? {
        val id = obj.optString(kind.idField)
        if (!safeId(id)) return null
        val ext = if (kind == Kind.SERIES) "" else
            safeExtension(kind,obj.optString("container_extension", "mp4")) ?: return null
        val name = title(obj.optString(if(kind==Kind.EPISODE) "title" else "name"))
        return Item(id,name,kind,ext)
    }
    private fun parseRows(array: JSONArray, kind: Kind): List<Item> {
        check(array.length() <= MAX_ITEMS) { "القائمة تتجاوز حد النسخة التجريبية" }
        return (0 until array.length()).mapNotNull { array.optJSONObject(it)?.let { obj -> row(obj,kind) } }
    }

    suspend fun list(credentials: ExternalStreamConnectClient.Credentials, kind: Kind,
        seriesId: String? = null): List<Item> = withContext(Dispatchers.IO) {
        val raw = read(credentials,kind,seriesId)
        if (kind != Kind.EPISODE) parseRows(JSONArray(raw),kind)
        else {
            val episodes = JSONObject(raw).optJSONObject("episodes") ?: error("صيغة الحلقات غير متوافقة")
            val output = mutableListOf<Item>()
            val keys = episodes.keys()
            while (keys.hasNext()) {
                val array = episodes.optJSONArray(keys.next()) ?: continue
                check(array.length() <= MAX_ITEMS-output.size) { "قائمة الحلقات كبيرة جدًا" }
                output.addAll(parseRows(array,kind))
            }
            output
        }
    }

    internal fun mediaUrl(credentials: ExternalStreamConnectClient.Credentials, item: Item): HttpUrl {
        require(item.kind != Kind.SERIES && safeId(item.id))
        val extension = requireNotNull(safeExtension(item.kind,item.extension))
        require(credentials.username !in setOf(".","..") && credentials.password !in setOf(".",".."))
        return requireNotNull(ExternalStreamConnectClient.parseHost(credentials.host.toString()))
            .newBuilder().addPathSegment(item.kind.path).addPathSegment(credentials.username)
            .addPathSegment(credentials.password).addPathSegment(item.id+"."+extension).build()
    }

    // Media3 receives only per-player opaque routes. Provider URLs are
    // resolved at the guarded HTTP layer; HLS children must remain same-origin.
    class PlaybackTarget(val uri: String, val client: OkHttpClient, val fallbackUri: String? = null)

    fun playback(credentials: ExternalStreamConnectClient.Credentials, item: Item): PlaybackTarget {
        val actual = mediaUrl(credentials,item)
        val routes = ExternalXtreamMediaRoutes(credentials.host)
        val primary = routes.add(actual, requireNotNull(safeExtension(item.kind,item.extension)))
        val fallback = if (item.kind == Kind.LIVE) {
            val hls = actual.newBuilder()
                .setPathSegment(actual.pathSegments.lastIndex, item.id + ".m3u8").build()
            routes.add(hls, "m3u8").toString()
        } else null
        val client = guardedMediaClient(routes, routes::resolve)
        return PlaybackTarget(primary.toString(),client,fallback)
    }

    internal fun guardedMediaClient(
        routes: ExternalXtreamMediaRoutes,
        resolve: (HttpUrl) -> HttpUrl
    ): OkHttpClient =
        ExternalStreamConnectVerifier.directClient.newBuilder()
            .readTimeout(25,TimeUnit.SECONDS).callTimeout(0,TimeUnit.SECONDS)
            .addInterceptor { chain ->
                val request = chain.request()
                if(request.method != "GET") throw IOException("CONNECT media method denied")
                var url = resolve(request.url)
                val response = try {
                    var current = chain.proceed(request.newBuilder().url(url).removeHeader("Authorization")
                        .removeHeader("Cookie").removeHeader("Referer").build())
                    var hops = 0
                    while (current.code in setOf(301,302,303,307,308)) {
                        val location = current.header("Location")
                        current.close()
                        if (++hops > 5 || location == null) throw IOException("External redirect limit")
                        url = routes.redirect(url,location)
                        // Follow the exact provider-supplied path; never copy credentials or
                        // authentication headers from the previous origin.
                        current = chain.proceed(request.newBuilder().url(url)
                            .removeHeader("Authorization").removeHeader("Cookie")
                            .removeHeader("Referer").build())
                    }
                    current
                } catch (_: IOException) { throw IOException("CONNECT media connection failed") }
                val sanitized = response.newBuilder().request(request)
                    .removeHeader("Location").removeHeader("Set-Cookie")
                    .priorResponse(null).networkResponse(null).cacheResponse(null)
                if (!response.isSuccessful) {
                    response.close()
                    sanitized.headers(okhttp3.Headers.Builder().build())
                        .body(ByteArray(0).toResponseBody(null)).build()
                } else {
                    try {
                        val body = response.body ?: throw IOException("External media response missing")
                        val manifest = url.encodedPath.endsWith(".m3u8", ignoreCase = true) ||
                            body.contentType()?.subtype?.contains("mpegurl", ignoreCase = true) == true ||
                            response.peekBody(7L).string() == "#EXTM3U"
                        if (!manifest) sanitized.build()
                        else {
                            val source = body.source()
                            source.request(2L * 1024 * 1024 + 1)
                            if (source.buffer.size > 2L * 1024 * 1024)
                                throw IOException("External HLS manifest too large")
                            val rewritten = routes.rewriteManifest(url, source.readUtf8())
                            response.close()
                            val bytes = rewritten.toByteArray(Charsets.UTF_8)
                            sanitized.removeHeader("Content-Encoding").removeHeader("Transfer-Encoding")
                                .header("Content-Length", bytes.size.toString())
                                .header("Content-Type", "application/vnd.apple.mpegurl")
                                .body(bytes.toResponseBody(null)).build()
                        }
                    } catch (_: Exception) {
                        response.close()
                        throw IOException("External media response invalid")
                    }
                }
            }.build()
}
