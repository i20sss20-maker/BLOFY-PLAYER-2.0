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
 * Large providers are keyset-paged so we never materialize the full series catalog in memory.
 * Existing cached episodes are reused; one unstable series never blocks every later title.
 */
object EpisodeCatalogPreloader {
    private const val KEY_PROVIDER_ID = "provider_id"
    private const val KEY_AFTER_ROW_ID = "after_row_id"
    private const val BATCH_SIZE = 24

    fun schedule(context: Context, providerId: String, afterRowId: Long = 0L, replace: Boolean = false) {
        if (providerId.isBlank()) return
        val request = OneTimeWorkRequestBuilder<EpisodePreloadWorker>()
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            .setInputData(
                Data.Builder()
                    .putString(KEY_PROVIDER_ID, providerId)
                    .putLong(KEY_AFTER_ROW_ID, afterRowId.coerceAtLeast(0L))
                    .build()
            )
            .setInitialDelay(if (afterRowId == 0L) 1 else 2, TimeUnit.SECONDS)
            .build()
        WorkManager.getInstance(context.applicationContext).enqueueUniqueWork(
            "blofy-episodes-$providerId",
            if (replace) ExistingWorkPolicy.REPLACE else ExistingWorkPolicy.APPEND_OR_REPLACE,
            request
        )
    }

    internal fun providerId(data: Data): String = data.getString(KEY_PROVIDER_ID).orEmpty()
    internal fun afterRowId(data: Data): Long = data.getLong(KEY_AFTER_ROW_ID, 0L).coerceAtLeast(0L)
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
        if (provider.providerType.equals("m3u", true)) {
            CatalogSyncState.markEpisodesReady(applicationContext, providerId)
            return Result.success()
        }
        if (!CatalogSyncState.isReady(applicationContext, providerId)) return Result.retry()

        val afterRowId = EpisodeCatalogPreloader.afterRowId(inputData)
        val page = dao.catalogPageAfterAll(providerId, "series", afterRowId, EpisodeCatalogPreloader.batchSize())
        if (page.isEmpty()) {
            CatalogSyncState.markEpisodesReady(applicationContext, providerId)
            return Result.success()
        }

        val manager = PlaylistManager(XtreamClient.api, dao)
        var retryCurrentBatch = false

        for (series in page) {
            if (isStopped) return Result.success()
            if (dao.episodeSnapshot(providerId, series.remoteId).isNotEmpty()) continue
            try {
                val result = manager.syncSeriesEpisodes(provider, series.remoteId)
                if (!result.payloadPresent) retryCurrentBatch = true
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (_: Exception) {
                retryCurrentBatch = true
            }
        }

        if (!CatalogSyncState.isReady(applicationContext, providerId)) return Result.success()
        if (retryCurrentBatch && runAttemptCount < MAX_BATCH_RETRIES) return Result.retry()

        val nextRowId = dao.streamRowId(page.last().key) ?: return Result.retry()
        if (page.size < EpisodeCatalogPreloader.batchSize()) {
            CatalogSyncState.markEpisodesReady(applicationContext, providerId)
        } else {
            EpisodeCatalogPreloader.schedule(applicationContext, providerId, nextRowId)
        }
        return Result.success()
    }

    companion object {
        private const val MAX_BATCH_RETRIES = 2
    }
}
