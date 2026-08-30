package tv.blofy.player.core.network

import android.content.Context
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DataSource
import androidx.media3.datasource.DefaultDataSource
import androidx.media3.datasource.DefaultHttpDataSource
import tv.blofy.player.core.provider.ProviderProfile

@OptIn(UnstableApi::class)
object TransportFactory {
    fun create(context: Context, profile: ProviderProfile): DataSource.Factory {
        val http = DefaultHttpDataSource.Factory()
            .setUserAgent("BLOFY PLAYER/2.0")
            .setConnectTimeoutMs(profile.connectTimeoutMs)
            .setReadTimeoutMs(profile.readTimeoutMs)
            .setAllowCrossProtocolRedirects(profile.allowCrossProtocolRedirects)
            .setDefaultRequestProperties(profile.headers)
        return DefaultDataSource.Factory(context.applicationContext, http)
    }
}
