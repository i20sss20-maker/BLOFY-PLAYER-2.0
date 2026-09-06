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
import tv.blofy.player.data.metadata.ProviderMetadataCache
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

        val staged = provider.copy(
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

            // Promotion is one Room transaction. Until it succeeds the previous provider remains
            // active and fully usable; this also avoids preserving flags by loading the old giant
            // catalog into PlaylistManager memory during the network parse.
            val refreshedProvider = provider.copy(enabled = true, updatedAt = staged.updatedAt)
            dao.promoteStagedCatalog(staged.id, refreshedProvider)
            promoted = true

            ProviderMetadataCache.clearProvider(app, provider.id)
            HomeSnapshotStore.clear(app, provider.id)
            CatalogSyncState.markCatalogCommitted(app, provider.id)

            // Keep the worker fast: only the small local entry snapshot/manifest is rebuilt here.
            // Deep metadata, episodes and artwork resume later through the normal Home lifecycle.
            tv.blofy.player.data.preparation.FullCatalogPreparer.prepare(app, provider.id) { }
            Result.success()
        } catch (_: Throwable) {
            if (!promoted) runCatching { dao.discardStagedCatalog(staged.id) }
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
