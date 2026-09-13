package tv.blofy.player.data.metadata

import android.content.Context
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import tv.blofy.player.data.local.ProviderEntity
import tv.blofy.player.data.local.StreamEntity

/** Called only for the title being viewed. Reopening details uses the persistent cache. */
internal object ProviderDetailsRepository {
    data class Result(val metadata: ProviderMetadata.Metadata?, val failed: Boolean = false)
    private val locks = Array(16) { Mutex() }
    private const val FRESH_FOR_MS = 12 * 60 * 60 * 1000L

    suspend fun refresh(context: Context, provider: ProviderEntity, stream: StreamEntity, force: Boolean = false): Result {
        if (!provider.providerType.equals("xtream", true) || stream.remoteId.isBlank())
            return Result(ProviderMetadataCache.read(context, stream.key))
        return locks[(stream.key.hashCode() and Int.MAX_VALUE) % locks.size].withLock {
            val cached = ProviderMetadataCache.read(context, stream.key)
            val age = System.currentTimeMillis() - ProviderMetadataCache.lastDetailFetch(context, stream.key)
            if (!force && age in 0 until FRESH_FOR_MS) return@withLock Result(cached)
            try {
                val fetched = if (stream.kind == "series") XtreamMetadataFallback.fetchSeries(provider, stream)
                    else XtreamMetadataFallback.fetchMovie(provider, stream)
                // A partial provider response must not discard useful cached cast or story.
                val merged = fetched?.let {
                    it.copy(overview = it.overview?.takeIf(String::isNotBlank) ?: cached?.overview,
                        cast = it.cast.ifEmpty { cached?.cast.orEmpty() },
                        crew = it.crew.ifEmpty { cached?.crew.orEmpty() })
                } ?: cached
                ProviderMetadataCache.write(context, provider.id, stream.key, merged)
                ProviderMetadataCache.markDetailFetched(context, stream.key, provider.id)
                Result(merged)
            } catch (_: TimeoutCancellationException) {
                Result(cached, failed = true)
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (_: Exception) {
                Result(cached, failed = true)
            }
        }
    }
}
