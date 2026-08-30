package tv.blofy.player.core.network

import android.content.Context
import androidx.media3.datasource.DataSource
import androidx.media3.datasource.DefaultDataSource
import androidx.media3.datasource.DefaultHttpDataSource
import tv.blofy.player.core.provider.ProviderProfile

/**
 * Fast-path transport for BLOFY 2.0.
 * No global Origin/Referer/Cookie/header injection. Provider-specific headers only.
 * Cronet is intentionally isolated behind this boundary so it can be enabled per provider
 * without changing Live/Movie/Series code.
 */
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
