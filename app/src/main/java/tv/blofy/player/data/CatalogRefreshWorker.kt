package tv.blofy.player.data

import android.content.Context
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import kotlinx.coroutines.flow.first
import tv.blofy.player.data.local.BlofyDatabase
import tv.blofy.player.data.remote.XtreamClient
import tv.blofy.player.ui.catalog.ArtworkLoader
import java.util.concurrent.TimeUnit

class CatalogRefreshWorker(
    appContext: Context,
    params: WorkerParameters
) : CoroutineWorker(appContext, params) {
    override suspend fun doWork(): Result {
        val dao = BlofyDatabase.get(applicationContext).dao()
        val providerId = inputData.getString(KEY_PROVIDER_ID)
        val provider = if (providerId.isNullOrBlank()) {
            dao.providers().first().firstOrNull()
        } else {
            dao.provider(providerId)
        } ?: return Result.success()

        if (!dao.hasCatalog(provider.id)) return Result.success()
        return try {
            val sync = PlaylistSyncPolicy.run {
                PlaylistManager(XtreamClient.api, dao).syncAll(provider)
            }
            if (sync.freshItemCount > 0 && sync.failedSectionCount == 0) {
                CatalogSyncState.markReady(applicationContext, provider.id)
                val warm = dao.latestHomeStreams(provider.id, 28)
                if (warm.isNotEmpty()) ArtworkLoader.warmPrefetch(
                    applicationContext,
                    warm.map { it.icon ?: it.backdrop }
                )
                Result.success()
            } else if (sync.failedSectionCount > 0) {
                Result.retry()
            } else {
                Result.success()
            }
        } catch (_: Throwable) {
            Result.retry()
        }
    }

    companion object {
        private const val KEY_PROVIDER_ID = "provider_id"
        private const val PERIODIC_NAME = "blofy-catalog-periodic"
        private const val NOW_NAME_PREFIX = "blofy-catalog-now:"

        private val constraints = Constraints.Builder()
            .setRequiredNetworkType(NetworkType.CONNECTED)
            .build()

        fun schedule(context: Context) {
            val request = PeriodicWorkRequestBuilder<CatalogRefreshWorker>(6, TimeUnit.HOURS)
                .setConstraints(constraints)
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
                .build()
            WorkManager.getInstance(context.applicationContext).enqueueUniquePeriodicWork(
                PERIODIC_NAME,
                ExistingPeriodicWorkPolicy.UPDATE,
                request
            )
        }

        fun enqueueNow(context: Context, providerId: String) {
            val request = OneTimeWorkRequestBuilder<CatalogRefreshWorker>()
                .setConstraints(constraints)
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 20, TimeUnit.SECONDS)
                .setInputData(androidx.work.workDataOf(KEY_PROVIDER_ID to providerId))
                .build()
            WorkManager.getInstance(context.applicationContext).enqueueUniqueWork(
                NOW_NAME_PREFIX + providerId,
                ExistingWorkPolicy.KEEP,
                request
            )
        }
    }
}
