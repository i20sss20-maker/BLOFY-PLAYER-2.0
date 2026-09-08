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
import tv.blofy.player.core.identity.PortalPlaylistClient
import tv.blofy.player.core.identity.PortalSyncBook
import tv.blofy.player.data.local.BlofyDatabase
import tv.blofy.player.data.remote.XtreamClient
import java.util.UUID
import java.util.concurrent.TimeUnit

/** Explicit/manual catalog refresh only. Opening or resuming the app never schedules this worker. */
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

        if (!dao.hasCatalog(provider.id)) return Result.success()

        // A website host/credential change is staged beside the known-good provider. Refresh the
        // pending source in the worker while Home keeps using the old local catalog.
        val sourceChanged = PortalSyncBook.hasPendingSource(app, provider.id)
        val refreshSource = if (sourceChanged) {
            PortalPlaylistClient.pendingSource(app, dao, provider.id) ?: return Result.retry()
        } else provider

        val previousCounts = CatalogRefreshIntegrityPolicy.Counts(
            live = dao.catalogCountAll(provider.id, "live"),
            movies = dao.catalogCountAll(provider.id, "movie"),
            series = dao.catalogCountAll(provider.id, "series")
        )

        // A full provider refresh temporarily needs room for the staged replacement + SQLite WAL.
        // If storage is critically low, keep the known-good catalog and retry later instead of
        // risking a half-written refresh on small Android boxes.
        LocalStorageManager.trimTemporaryIfNeeded(app)
        if (!LocalStorageManager.hasHealthyFreeSpace(app)) return Result.retry()

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
                dao.discardStagedCatalog(staged.id)
                return if (sync.failedSectionCount > 0) Result.retry() else Result.success()
            }

            if (!sourceChanged) {
                val candidateCounts = CatalogRefreshIntegrityPolicy.Counts(
                    live = dao.catalogCountAll(staged.id, "live"),
                    movies = dao.catalogCountAll(staged.id, "movie"),
                    series = dao.catalogCountAll(staged.id, "series")
                )
                if (!CatalogRefreshIntegrityPolicy.accepts(previousCounts, candidateCounts)) {
                    // A valid-looking HTTP/JSON response can still be truncated or temporarily empty.
                    // Never let that destroy a working local library; leave the previous snapshot live.
                    dao.discardStagedCatalog(staged.id)
                    return Result.retry()
                }
            }

            val refreshedProvider = refreshSource.copy(enabled = true, updatedAt = staged.updatedAt)
            if (sourceChanged) {
                // Serialize promotion with portal edits. If the website changes again while this
                // worker is downloading, the stale candidate is rejected and the old catalog stays live.
                PortalPlaylistClient.commitPendingSource(app, dao, refreshSource) {
                    dao.promoteStagedCatalog(staged.id, refreshedProvider)
                    CatalogSyncState.markSourceReplaced(app, provider.id)
                }
            } else {
                dao.promoteStagedRefresh(staged.id, refreshedProvider)
                CatalogSyncState.markCatalogCommitted(app, provider.id)
            }
            promoted = true

            // Promotion itself is the durable point of no return. From here on, never turn a local
            // Home/manifest preparation problem into another full network download. The new catalog
            // is already complete and active; entry preparation is recoverable on the next launch.
            runCatching {
                tv.blofy.player.data.preparation.FullCatalogPreparer.prepare(app, provider.id) { }
            }
            Result.success()
        } catch (_: Throwable) {
            if (!promoted) {
                runCatching { dao.discardStagedCatalog(staged.id) }
                Result.retry()
            } else {
                // A post-promotion failure must not redownload the provider. The promoted catalog
                // stays active and the normal cache-first entry path can rebuild local snapshots.
                Result.success()
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
