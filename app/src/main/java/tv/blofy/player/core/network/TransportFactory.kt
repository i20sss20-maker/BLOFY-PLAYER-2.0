package tv.blofy.player.core.network

import android.content.Context
import androidx.annotation.OptIn
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DataSource
import androidx.media3.datasource.DefaultDataSource
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.datasource.HttpDataSource
import androidx.media3.datasource.cronet.CronetDataSource
import org.chromium.net.CronetEngine
import tv.blofy.player.core.provider.ProviderProfile
import tv.blofy.player.core.provider.TransportPreference
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

@OptIn(markerClass = [UnstableApi::class])
object TransportFactory {
    private val cronetExecutor: ExecutorService by lazy { Executors.newCachedThreadPool() }

    fun create(context: Context, profile: ProviderProfile): DataSource.Factory {
        val appContext = context.applicationContext
        val upstream: HttpDataSource.Factory = when (profile.transport) {
            TransportPreference.CRONET_FIRST -> createCronet(appContext, profile) ?: createHttp(profile)
            TransportPreference.HTTP_FIRST -> createHttp(profile)
        }
        return DefaultDataSource.Factory(appContext, upstream)
    }

    private fun createCronet(context: Context, profile: ProviderProfile): HttpDataSource.Factory? =
        runCatching {
            val engine = CronetEngine.Builder(context)
                .enableHttp2(true)
                .enableQuic(true)
                .build()
            CronetDataSource.Factory(engine, cronetExecutor)
                .setUserAgent("BLOFY PLAYER/2.0")
                .setConnectTimeoutMs(profile.connectTimeoutMs)
                .setReadTimeoutMs(profile.readTimeoutMs)
                .setDefaultRequestProperties(profile.headers)
        }.getOrNull()

    private fun createHttp(profile: ProviderProfile): HttpDataSource.Factory =
        DefaultHttpDataSource.Factory()
            .setUserAgent("BLOFY PLAYER/2.0")
            .setConnectTimeoutMs(profile.connectTimeoutMs)
            .setReadTimeoutMs(profile.readTimeoutMs)
            .setAllowCrossProtocolRedirects(profile.allowCrossProtocolRedirects)
            .setDefaultRequestProperties(profile.headers)
}
