package tv.blofy.player.core.network

import android.content.Context
import androidx.annotation.OptIn
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DataSource
import androidx.media3.datasource.DefaultDataSource
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.datasource.HttpDataSource
import androidx.media3.datasource.cronet.CronetDataSource
import androidx.media3.datasource.okhttp.OkHttpDataSource
import okhttp3.OkHttpClient
import tv.blofy.player.BuildConfig
import tv.blofy.player.core.identity.StreamCodeSession
import org.chromium.net.CronetEngine
import tv.blofy.player.core.provider.ProviderProfile
import tv.blofy.player.core.provider.TransportPreference
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

@OptIn(markerClass = [UnstableApi::class])
object TransportFactory {
    private val cronetExecutor: ExecutorService by lazy { Executors.newCachedThreadPool() }
    @Volatile private var cronetEngine: CronetEngine? = null

    fun create(context: Context, profile: ProviderProfile): DataSource.Factory {
        val appContext = context.applicationContext
        val upstreamHttp: HttpDataSource.Factory =
            if (BuildConfig.CODE_ONLY_LOGIN &&
                profile.providerKey == StreamCodeSession.providerId) {
                secureCodeOnlyHttp(appContext)
            } else when (profile.transport) {
            TransportPreference.CRONET_FIRST -> createCronet(appContext, profile) ?: createHttp(profile)
            TransportPreference.HTTP_FIRST -> createHttp(profile)
        }
        val upstream = DefaultDataSource.Factory(appContext, upstreamHttp)
        return PlaybackCache.readOnly(appContext, upstream)
    }

    // The bearer must NEVER be copied into third-party redirects or provider
    // direct_source URLs. A network interceptor runs on every redirected hop,
    // adds the token only to BLOFY's own fixed HTTPS media path, and removes
    // Authorization on any other host, even on cross-host 302 redirects.
    private fun secureCodeOnlyHttp(context: Context): HttpDataSource.Factory {
        val client=OkHttpClient.Builder()
            .followRedirects(true).followSslRedirects(false)
            .connectTimeout(12,java.util.concurrent.TimeUnit.SECONDS)
            .readTimeout(30,java.util.concurrent.TimeUnit.SECONDS)
            .addNetworkInterceptor { chain ->
                val req=chain.request()
                val url=req.url
                val trusted=url.scheme=="https" && url.host=="blofyplayer.com" &&
                    url.encodedPath.startsWith("/api/v1/stream/media/")
                val next=req.newBuilder().removeHeader("Authorization")
                if(trusted){
                    StreamCodeSession.authorization(context)?.let {
                        next.header("Authorization",it)
                    }
                }
                chain.proceed(next.build())
            }.build()
        return OkHttpDataSource.Factory(client)
            .setUserAgent("BLOFY STREAM/1.0")
    }

    private fun createCronet(context: Context, profile: ProviderProfile): HttpDataSource.Factory? {
        return runCatching {
            val engine = getCronetEngine(context)
            val factory: CronetDataSource.Factory = CronetDataSource.Factory(engine, cronetExecutor)
                .setUserAgent("BLOFY PLAYER/2.0")
            factory.setDefaultRequestProperties(profile.headers)
            factory
        }.getOrNull()
    }

    private fun getCronetEngine(context: Context): CronetEngine =
        cronetEngine ?: synchronized(this) {
            cronetEngine ?: CronetEngine.Builder(context.applicationContext)
                .enableHttp2(true)
                .enableQuic(true)
                .build()
                .also { cronetEngine = it }
        }

    private fun createHttp(profile: ProviderProfile): HttpDataSource.Factory =
        DefaultHttpDataSource.Factory()
            .setUserAgent("BLOFY PLAYER/2.0")
            .setConnectTimeoutMs(profile.connectTimeoutMs)
            .setReadTimeoutMs(profile.readTimeoutMs)
            .setAllowCrossProtocolRedirects(profile.allowCrossProtocolRedirects)
            .setDefaultRequestProperties(profile.headers)
}
