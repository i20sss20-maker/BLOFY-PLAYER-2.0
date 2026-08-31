package tv.blofy.player.core.network

import android.content.Context
import androidx.annotation.OptIn
import androidx.media3.common.util.UnstableApi
import androidx.media3.database.StandaloneDatabaseProvider
import androidx.media3.datasource.DataSource
import androidx.media3.datasource.cache.CacheDataSource
import androidx.media3.datasource.cache.NoOpCacheEvictor
import androidx.media3.datasource.cache.SimpleCache

@OptIn(markerClass = [UnstableApi::class])
object PlaybackCache {
    @Volatile private var cache: SimpleCache? = null

    private fun get(context: Context): SimpleCache = cache ?: synchronized(this) {
        cache ?: SimpleCache(
            context.applicationContext.getDir("blofy_media_cache", Context.MODE_PRIVATE),
            NoOpCacheEvictor(),
            StandaloneDatabaseProvider(context.applicationContext)
        ).also { cache = it }
    }

    /**
     * Mirrors the read-only playback-cache policy observed in the reference app:
     * playback may read cached spans, but normal streaming never writes new spans.
     */
    fun readOnly(context: Context, upstream: DataSource.Factory): DataSource.Factory =
        CacheDataSource.Factory()
            .setCache(get(context))
            .setUpstreamDataSourceFactory(upstream)
            .setCacheWriteDataSinkFactory(null)
            .setFlags(CacheDataSource.FLAG_IGNORE_CACHE_ON_ERROR)
}
