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
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.withContext
import tv.blofy.player.core.identity.PortalPlaylistClient
import tv.blofy.player.core.identity.PortalSyncBook
import tv.blofy.player.data.local.BlofyDatabase
import tv.blofy.player.data.local.BlofyDao
import tv.blofy.player.data.remote.XtreamClient
import java.util.UUID
import java.util.concurrent.TimeUnit

/** Explicit/manual or source-change catalog refresh. Opening a normal saved list never schedules it. */
class CatalogRefreshWorker(
    appContext: Context,
    params: WorkerParameters
) : CoroutineWorker(appContext, params) {
    override suspend fun doWork(): Result {
        val app = applicationContext
        val dao = BlofyDatabase.get(app).dao()
        val providerId = inputData.getString(KEY_PROVIDER_ID)
        val provider = if (providerId.isNullOrBlank()) {
            dao.providers().first().firstOrNull()
        } else {
            dao.provider(providerId)
        } ?: return Result.success()

        // A first import writes batches before it commits; those rows are not a refresh baseline.
        if (!CatalogSyncState.isReady(app, provider.id) || !dao.hasCatalog(provider.id)) return Result.success()

        val sourceChanged = PortalSyncBook.hasPendingSource(app, provider.id)
        val refreshSource = if (sourceChanged) {
            PortalPlaylistClient.pendingSource(app, dao, provider.id) ?: return Result.retry()
        } else provider

        val previousCounts = CatalogRefreshIntegrityPolicy.Counts(
            live = dao.catalogCountAll(provider.id, "live"),
            movies = dao.catalogCountAll(provider.id, "movie"),
            series = dao.catalogCountAll(provider.id, "series")
        )

        if (!LocalStorageManager.prepareForCatalogRefresh(app)) return Result.retry()

        val staged = refreshSource.copy(
            id = UUID.randomUUID().toString(),
            enabled = false,
            updatedAt = System.currentTimeMillis()
        )
        var promoted = false
        return try {
            val sync = PlaylistSyncPolicy.run {
                PlaylistManager(XtreamClient.api, dao).syncAll(staged)
            }
            if (sync.freshItemCount <= 0 || sync.failedSectionCount > 0) {
                return if (sync.failedSectionCount > 0) Result.retry() else Result.success()
            }

            val candidateCounts = CatalogRefreshIntegrityPolicy.Counts(
                live = dao.catalogCountAll(staged.id, "live"),
                movies = dao.catalogCountAll(staged.id, "movie"),
                series = dao.catalogCountAll(staged.id, "series")
            )
            // A website host/credential change for the same playlist must not be allowed to replace
            // a known-good 50k/100k library with a truncated but syntactically valid response.
            if (!CatalogRefreshIntegrityPolicy.accepts(previousCounts, candidateCounts)) {
                return Result.retry()
            }

            val refreshedProvider = refreshSource.copy(enabled = true, updatedAt = staged.updatedAt)
            currentCoroutineContext().ensureActive()
            if (sourceChanged) {
                PortalPlaylistClient.commitPendingSource(app, dao, refreshSource) {
                    dao.promoteStagedBackgroundRefresh(staged.id, provider, refreshedProvider)
                    promoted = true
                    runCatching { CatalogSyncState.markSourceReplaced(app, provider.id) }
                }
            } else {
                withContext(NonCancellable + Dispatchers.IO) {
                    dao.promoteStagedBackgroundRefresh(staged.id, provider, refreshedProvider)
                    promoted = true
                    runCatching { CatalogSyncState.markCatalogCommitted(app, provider.id) }
                }
            }

            // Promotion is the durable result. Do not immediately rebuild Home/FTS/manifest here;
            // CatalogEnrichmentLifecycle owns that work after its UI quiet period so Room/CPU do not
            // compete with the user just after opening Home.
            Result.success()
        } catch (_: TimeoutCancellationException) {
            // A provider timeout is retryable; a cancelled Worker must still stop immediately.
            currentCoroutineContext().ensureActive()
            if (promoted) Result.success() else Result.retry()
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (_: Exception) {
            if (promoted) Result.success() else Result.retry()
        } finally {
            if (!promoted) {
                runCatching { discardStagedCatalogSafely(dao, staged.id) }
            }
        }
    }

    companion object {
        private const val KEY_PROVIDER_ID = "provider_id"
        private const val LEGACY_PERIODIC_NAME = "blofy-catalog-periodic"
        private const val NOW_NAME_PREFIX = "blofy-catalog-now:"

        private val constraints = Constraints.Builder()
            .setRequiredNetworkType(NetworkType.CONNECTED)
            .build()

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

internal suspend fun discardStagedCatalogSafely(dao: BlofyDao, stagedProviderId: String) {
    withContext(NonCancellable + Dispatchers.IO) { dao.discardStagedCatalog(stagedProviderId) }
}
