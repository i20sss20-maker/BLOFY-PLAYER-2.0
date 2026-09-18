package tv.blofy.player.data.preparation

import android.content.Context
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.Data
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.CancellationException
import tv.blofy.player.data.CatalogSyncState
import tv.blofy.player.ui.catalog.ArtworkLoader

class FullLibrarySyncWorker(
    appContext: Context,
    params: WorkerParameters
) : CoroutineWorker(appContext, params) {

    override suspend fun doWork(): Result {
        val providerId = inputData.getString(KEY_PROVIDER_ID).orEmpty()
        if (providerId.isBlank()) return Result.success()
        if (!CatalogSyncState.isReady(applicationContext, providerId)) return Result.success()

        return try {
            val complete = FullCatalogPreparer.runDurableChunk(
                applicationContext,
                providerId,
                MAX_RUN_MS
            )
            if (!complete) enqueueContinuation(applicationContext, providerId)
            Result.success()
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (_: ArtworkLoader.StorageFull) {
            // Keep already-downloaded library files. A later app start will enqueue the worker
            // again after the user has freed storage.
            Result.success()
        } catch (_: Throwable) {
            Result.retry()
        }
    }

    companion object {
        private const val KEY_PROVIDER_ID = "provider_id"
        private const val MAX_RUN_MS = 6L * 60L * 1000L

        private fun workName(providerId: String) = "blofy-full-library:$providerId"

        private fun request(providerId: String, delaySeconds: Long) =
            OneTimeWorkRequestBuilder<FullLibrarySyncWorker>()
                .setInputData(Data.Builder().putString(KEY_PROVIDER_ID, providerId).build())
                .setConstraints(
                    Constraints.Builder()
                        .setRequiredNetworkType(NetworkType.CONNECTED)
                        .setRequiresStorageNotLow(true)
                        .build()
                )
                .setInitialDelay(delaySeconds, TimeUnit.SECONDS)
                .setBackoffCriteria(BackoffPolicy.LINEAR, 15, TimeUnit.SECONDS)
                .addTag(workName(providerId))
                .build()

        fun enqueue(context: Context, providerId: String) {
            if (providerId.isBlank()) return
            WorkManager.getInstance(context.applicationContext).enqueueUniqueWork(
                workName(providerId),
                ExistingWorkPolicy.KEEP,
                request(providerId, 4)
            )
        }

        private fun enqueueContinuation(context: Context, providerId: String) {
            WorkManager.getInstance(context.applicationContext).enqueueUniqueWork(
                workName(providerId),
                ExistingWorkPolicy.APPEND_OR_REPLACE,
                request(providerId, 2)
            )
        }

        fun cancel(context: Context, providerId: String) {
            if (providerId.isBlank()) return
            WorkManager.getInstance(context.applicationContext).cancelUniqueWork(workName(providerId))
        }
    }
}
