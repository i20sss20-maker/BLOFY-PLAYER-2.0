package tv.blofy.player.data

import android.content.Context
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.Data
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import kotlinx.coroutines.CancellationException
import tv.blofy.player.data.local.BlofyDatabase
import tv.blofy.player.data.remote.XtreamClient
import java.util.concurrent.TimeUnit

/**
 * Fills the local episode table in small background batches after the main catalog is ready.
 * Home opens immediately; large servers continue caching series episodes without blocking TV UI.
 *
 * A batch is only advanced after every series in that batch either has cached episodes or returned
 * a valid provider payload. Temporary network/provider failures retry the same batch; rows already
 * cached on the previous attempt are skipped, so only the missing series are fetched again.
 */
object EpisodeCatalogPreloader {
    private const val KEY_PROVIDER_ID = "provider_id"
    private const val KEY_OFFSET = "offset"
    private const val BATCH_SIZE = 24

    fun schedule(context: Context, providerId: String, offset: Int = 0, replace: Boolean = false) {
        if (providerId.isBlank()) return
        val request = OneTimeWorkRequestBuilder<EpisodePreloadWorker>()
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            .setInputData(
                Data.Builder()
                    .putString(KEY_PROVIDER_ID, providerId)
                    .putInt(KEY_OFFSET, offset.coerceAtLeast(0))
                    .build()
            )
            .setInitialDelay(if (offset == 0) 1 else 2, TimeUnit.SECONDS)
            .build()
        WorkManager.getInstance(context.applicationContext).enqueueUniqueWork(
            "blofy-episodes-$providerId",
            if (replace) ExistingWorkPolicy.REPLACE else ExistingWorkPolicy.APPEND_OR_REPLACE,
            request
        )
    }

    internal fun providerId(data: Data): String = data.getString(KEY_PROVIDER_ID).orEmpty()
    internal fun offset(data: Data): Int = data.getInt(KEY_OFFSET, 0).coerceAtLeast(0)
    internal fun batchSize(): Int = BATCH_SIZE
}

class EpisodePreloadWorker(
    appContext: Context,
    params: WorkerParameters
) : CoroutineWorker(appContext, params) {
    override suspend fun doWork(): Result {
        val providerId = EpisodeCatalogPreloader.providerId(inputData)
        if (providerId.isBlank()) return Result.failure()

        val dao = BlofyDatabase.get(applicationContext).dao()
        val provider = dao.provider(providerId) ?: return Result.success()
        if (provider.providerType.equals("m3u", true)) return Result.success()
        if (!CatalogSyncState.isReady(applicationContext, providerId)) return Result.retry()

        val allSeries = dao.streamSnapshot(providerId, "series")
        if (allSeries.isEmpty()) return Result.success()
        val offset = EpisodeCatalogPreloader.offset(inputData)
        if (offset >= allSeries.size) return Result.success()

        val manager = PlaylistManager(XtreamClient.api, dao)
        val end = (offset + EpisodeCatalogPreloader.batchSize()).coerceAtMost(allSeries.size)
        var retryCurrentBatch = false

        for (index in offset until end) {
            if (isStopped) return Result.success()
            val series = allSeries[index]
            if (dao.episodeSnapshot(providerId, series.remoteId).isNotEmpty()) continue
            try {
                val result = manager.syncSeriesEpisodes(provider, series.remoteId)
                if (!result.payloadPresent) retryCurrentBatch = true
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (_: Exception) {
                // Continue this batch so one unstable title never blocks the other series. We then
                // retry the same offset; everything cached successfully is skipped on the retry.
                retryCurrentBatch = true
            }
        }

        if (!CatalogSyncState.isReady(applicationContext, providerId)) return Result.success()
        // Retry transient provider failures, but never let one permanently broken/unsupported
        // series block every later series in a very large catalog. A future catalog refresh starts
        // again from offset 0 and will retry any still-missing titles.
        if (retryCurrentBatch && runAttemptCount < MAX_BATCH_RETRIES) return Result.retry()

        if (end < allSeries.size) {
            EpisodeCatalogPreloader.schedule(applicationContext, providerId, end)
        }
        return Result.success()
    }

    companion object {
        private const val MAX_BATCH_RETRIES = 2
    }
}
