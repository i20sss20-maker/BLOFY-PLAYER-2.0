package tv.blofy.player.data

import android.content.Context
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import kotlinx.coroutines.flow.first
import tv.blofy.player.data.local.BlofyDatabase
import tv.blofy.player.data.remote.XtreamClient
import tv.blofy.player.ui.catalog.ArtworkLoader
import java.util.concurrent.TimeUnit

/** Explicit/manual catalog refresh only. Opening or resuming the app never schedules this worker. */
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
                val warm = dao.latestHomeStreams(provider.id, 40)
                if (warm.isNotEmpty()) ArtworkLoader.warmPrefetch(
                    applicationContext,
                    warm.map { it.backdrop ?: it.icon }
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
        private const val LEGACY_PERIODIC_NAME = "blofy-catalog-periodic"
        private const val NOW_NAME_PREFIX = "blofy-catalog-now:"

        private val constraints = Constraints.Builder()
            .setRequiredNetworkType(NetworkType.CONNECTED)
            .build()

        /** Remove periodic work registered by older builds so upgrades become truly cache-first. */
        fun cancelLegacyAutomatic(context: Context) {
            WorkManager.getInstance(context.applicationContext).cancelUniqueWork(LEGACY_PERIODIC_NAME)
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
