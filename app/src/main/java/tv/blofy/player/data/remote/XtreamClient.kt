package tv.blofy.player.data.remote

import android.content.Context
import tv.blofy.player.BuildConfig
import tv.blofy.player.core.identity.StreamCodeSession
import tv.blofy.player.core.device.StreamDeviceCompatibility
import okhttp3.Dispatcher
import okhttp3.OkHttpClient
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory
import java.util.concurrent.TimeUnit

object XtreamClient {
    @Volatile private var application: Context? = null
    fun initialize(context: Context) {
        application = context.applicationContext
        if (BuildConfig.CODE_ONLY_LOGIN) {
            // Bound catalog requests only; playback uses a separate transport. This prevents
            // slow metadata endpoints from exhausting memory/sockets on inexpensive TV boxes.
            val device = StreamDeviceCompatibility.current(context)
            okHttp.dispatcher.maxRequestsPerHost = device.maxCatalogRequestsPerHost
            okHttp.dispatcher.maxRequests = maxOf(8, device.maxCatalogRequestsPerHost * 2)
        }
    }

    private val okHttp = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        // Large Xtream lists are streamed and may pause between chunks on overloaded panels.
        // This is an inactivity timeout, not a total download timeout; keep it generous enough
        // that a healthy huge catalog is not killed halfway through while still bounding a dead read.
        .readTimeout(90, TimeUnit.SECONDS)
        .followRedirects(true)
        .followSslRedirects(true)
        .retryOnConnectionFailure(true)
        .addInterceptor { chain ->
            val original = chain.request()
            val request = original.newBuilder()
                .header("User-Agent", original.header("User-Agent") ?: "BLOFY PLAYER/2.0 (Android TV)")
                .header("Accept", original.header("Accept") ?: "application/json,text/plain,*/*")
                .apply {
                    // Keep bulk-catalog compatibility; allow OkHttp's transparent gzip for
                    // the small, user-selected series detail request.
                    if (original.url.queryParameter("action") != "get_series_info") {
                        header("Accept-Encoding", original.header("Accept-Encoding") ?: "identity")
                    }
                }
                .build()
            val response = chain.proceed(request)

            // Several IPTV/Xtream gateways use the non-standard HTTP status 884 while returning
            // a valid JSON/M3U payload. Retrofit rejects every non-2xx status before converters can
            // inspect the body, which made whole Live/VOD/Series sections disappear. Preserve the
            // exact payload and headers but normalize only 884 to 200 so Gson/streaming parsing is
            // still the authority: malformed bodies continue to fail and can never replace cache.
            if (response.code == 884) {
                response.newBuilder()
                    .code(200)
                    .message("OK (BLOFY normalized upstream 884)")
                    .header("X-BLOFY-Upstream-Status", "884")
                    .build()
            } else {
                response
            }
        }
        // Network interceptors run separately for every redirect. Remove
        // authorization from any untrusted hostname or path before it leaves
        // the device; inject the app session ONLY at BLOFY's HTTPS catalog API.
        .addNetworkInterceptor { chain ->
            val original=chain.request()
            if (!BuildConfig.CODE_ONLY_LOGIN) return@addNetworkInterceptor chain.proceed(original)
            val url=original.url
            val trusted=url.scheme=="https" && url.host=="blofyplayer.com" &&
                url.encodedPath=="/player_api.php"
            val next=original.newBuilder().removeHeader("Authorization")
            if (trusted) {
                application?.let { StreamCodeSession.authorization(it) }?.let {
                    next.header("Authorization",it)
                }
            }
            chain.proceed(next.build())
        }
        .build()

    val api: XtreamApi by lazy { createApi(okHttp) }

    // A foreground episode request must not queue behind bulk catalogs/EPG requests
    // or inherit their 90-second inactivity timeout (with no total deadline).
    internal fun episodeClient(base: OkHttpClient = okHttp): OkHttpClient = base.newBuilder()
        .dispatcher(Dispatcher())
        .connectTimeout(5, TimeUnit.SECONDS)
        .readTimeout(12, TimeUnit.SECONDS)
        .callTimeout(25, TimeUnit.SECONDS)
        .build()

    val episodeApi: XtreamApi by lazy { createApi(episodeClient()) }

    internal fun createApi(client: OkHttpClient): XtreamApi = Retrofit.Builder()
            .baseUrl("https://localhost/")
            .client(client)
            .addConverterFactory(GsonConverterFactory.create())
            .build()
            .create(XtreamApi::class.java)
}
