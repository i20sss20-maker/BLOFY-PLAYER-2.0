package tv.blofy.player.data.remote

import okhttp3.HttpUrl
import okhttp3.OkHttpClient
import tv.blofy.player.core.identity.ExternalStreamConnectClient
import tv.blofy.player.core.identity.ExternalStreamConnectVerifier
import java.io.IOException
import java.util.concurrent.TimeUnit

/**
 * Catalog transport for the original streaming PlaylistManager. A synthetic URL
 * is passed to Retrofit; provider secrets never enter catalog URLs or Room.
 * The existing public-address DNS guard and no-redirect policy remain in force.
 */
internal object ExternalXtreamCatalogTransport {
    const val ORIGIN = "https://external-xtream.invalid"
    private val allowed = mapOf(
        "get_live_categories" to emptySet<String>(),
        "get_vod_categories" to emptySet<String>(),
        "get_series_categories" to emptySet<String>(),
        "get_live_streams" to setOf("category_id"),
        "get_vod_streams" to setOf("category_id"),
        "get_series" to setOf("category_id"),
        "get_series_info" to setOf("series_id"),
        "get_vod_info" to setOf("vod_id"),
        "get_short_epg" to setOf("stream_id", "limit"),
        "get_simple_data_table" to setOf("stream_id")
    )
    private val identifier = Regex("[0-9]{1,15}")

    internal fun resolve(
        opaque: HttpUrl,
        credentials: ExternalStreamConnectClient.Credentials
    ): HttpUrl {
        require(opaque.scheme == "https" && opaque.host == "external-xtream.invalid" &&
            opaque.port == 443 && opaque.encodedPath == "/player_api.php" &&
            opaque.username.isEmpty() && opaque.password.isEmpty() && opaque.fragment == null)
        val action = requireNotNull(opaque.queryParameter("action"))
        val fields = requireNotNull(allowed[action])
        require(opaque.queryParameterNames.all { it == "action" || it in fields })
        require(opaque.queryParameterNames.all { opaque.queryParameterValues(it).size == 1 })
        val required = when (action) {
            "get_series_info" -> "series_id"
            "get_vod_info" -> "vod_id"
            "get_short_epg", "get_simple_data_table" -> "stream_id"
            else -> null
        }
        if (required != null) require(opaque.queryParameter(required) != null)
        val host = requireNotNull(ExternalStreamConnectClient.parseHost(credentials.host.toString()))
        val actual = host.newBuilder().addPathSegment("player_api.php")
            .addQueryParameter("username", credentials.username)
            .addQueryParameter("password", credentials.password)
            .addQueryParameter("action", action)
        for (field in fields) {
            val value = opaque.queryParameter(field) ?: continue
            require(identifier.matches(value))
            if (field == "limit") require(value.toLong() in 1L..1000L)
            actual.addQueryParameter(field, value)
        }
        return actual.build()
    }

    internal fun client(credentials: ExternalStreamConnectClient.Credentials): OkHttpClient =
        ExternalStreamConnectVerifier.directClient.newBuilder()
            .readTimeout(90, TimeUnit.SECONDS)
            .callTimeout(180, TimeUnit.SECONDS)
            .addInterceptor { chain ->
                val request = chain.request()
                if (request.method != "GET") throw IOException("External catalog method denied")
                val actual = try { resolve(request.url, credentials) }
                    catch (_: IllegalArgumentException) { throw IOException("External catalog route denied") }
                val response = try {
                    chain.proceed(request.newBuilder().url(actual)
                        .removeHeader("Authorization").removeHeader("Cookie").build())
                } catch (_: IOException) {
                    throw IOException("External catalog connection failed")
                }
                // Keep credentials out of Retrofit error URLs and redirect headers.
                response.newBuilder().request(request)
                    .removeHeader("Location").removeHeader("Set-Cookie")
                    .priorResponse(null).networkResponse(null).cacheResponse(null).build()
            }.build()

    fun api(credentials: ExternalStreamConnectClient.Credentials): XtreamApi =
        XtreamClient.createApi(client(credentials))
}
