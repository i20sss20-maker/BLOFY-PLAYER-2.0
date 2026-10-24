package tv.blofy.player.data

import android.content.Context
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingWorkPolicy
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.PeriodicWorkRequestBuilder
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
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import tv.blofy.player.core.identity.PortalPlaylistClient
import tv.blofy.player.core.identity.PortalSyncBook
import tv.blofy.player.data.local.BlofyDatabase
import tv.blofy.player.data.local.BlofyDao
import tv.blofy.player.data.local.ProviderEntity
import tv.blofy.player.data.preparation.CatalogLoadPersistence
import tv.blofy.player.data.remote.XtreamClient
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit

/** Atomic, playback-friendly catalog refresh for manual and fast silent periodic updates. */
class CatalogRefreshWorker(
    appContext: Context,
    params: WorkerParameters
) : CoroutineWorker(appContext, params) {
    override suspend fun doWork(): Result {
        return try {
        val app = applicationContext
        val dao = BlofyDatabase.get(app).dao()
        val providerId = inputData.getString(KEY_PROVIDER_ID)
        val provider = if (providerId.isNullOrBlank()) {
            dao.providers().first().firstOrNull()
        } else {
            dao.provider(providerId)
        } ?: return Result.success()
        val manual = inputData.getBoolean(KEY_MANUAL, false)
        // A pending periodic job for a previously selected account must not
        // consume data or disk on a different active playlist.
        if (!manual && dao.activeProviderId() != provider.id) return Result.success()
        // Only worker requests serialize during the long download. Normal entry into a
        // committed library must not wait behind hours of provider/network I/O.
        workerLocks.getOrPut(provider.id) { Mutex() }.withLock {
            refreshCatalog(provider, dao, manual)
        }
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (_: Exception) {
            // A temporary encrypted-provider/Room read failure should not permanently
            // disable periodic work. WorkManager can back off and retry safely.
            Result.retry()
        }
    }

    private suspend fun refreshCatalog(provider: ProviderEntity, dao: BlofyDao, manual: Boolean): Result {
        val app = applicationContext
        // A first import writes batches before it commits; those rows are not a refresh baseline.
        if (!CatalogSyncState.isReady(app, provider.id) || !dao.hasCatalog(provider.id)) return Result.success()

        val sourceChanged = PortalSyncBook.hasPendingSource(app, provider.id)
        if (!manual && !sourceChanged && !CatalogAutoRefreshPolicy.isDue(
                CatalogSyncState.lastSyncedAt(app, provider.id), System.currentTimeMillis()
            )
        ) return Result.success()
        // A streaming player must not compete with a full-library download/SQLite promotion.
        if (CatalogPlaybackGate.isPlaying) return Result.retry()
        val refreshSource = if (sourceChanged) {
            PortalPlaylistClient.pendingSource(app, dao, provider.id) ?: return Result.retry()
        } else provider

        val previousCounts = CatalogRefreshIntegrityPolicy.Counts(
            live = dao.catalogCountAll(provider.id, "live"),
            movies = dao.catalogCountAll(provider.id, "movie"),
            series = dao.catalogCountAll(provider.id, "series")
        )

        if (!LocalStorageManager.prepareForCatalogRefresh(app)) return Result.retry()

        // Persist completed sections across ordinary WorkManager's time budget. A retry
        // skips validated live/movie/series sections instead of starting the full list over.
        val checkpoint = CatalogRefreshCheckpoint(app, provider.id)
        val saved = checkpoint.prepare(refreshSource, dao)
        val staged = refreshSource.copy(
            id = saved.stagedId,
            enabled = false,
            updatedAt = System.currentTimeMillis()
        )
        var promoted = false
        // Persist only coarse stages; saving progress for every Xtream item would slow the TV.
        var reportedStage: PlaylistSyncStage? = null
        return try {
            val sync = PlaylistSyncPolicy.run(CatalogAutoRefreshPolicy.MAX_SINGLE_SYNC_MS) {
                PlaylistManager(XtreamClient.api, dao).syncAll(
                    staged,
                    completedSections = saved.completed,
                    onSectionComplete = { kind -> checkpoint.completed(saved, kind, dao) },
                    onProgress = { progress ->
                        if (CatalogPlaybackGate.isPlaying) throw PlaybackInProgressException()
                        if (reportedStage != progress.stage) {
                            reportedStage = progress.stage
                            setProgress(androidx.work.workDataOf("catalog_stage" to progress.stage.name))
                        }
                    }
                )
            }
            if (sync.failedSectionCount > 0) return Result.retry()
            if (sync.freshItemCount <= 0) {
                // A zero-item Xtream reply must never replace the known-good catalog.
                checkpoint.discard(saved, dao)
                return Result.retry()
            }

            val candidateCounts = CatalogRefreshIntegrityPolicy.Counts(
                live = dao.catalogCountAll(staged.id, "live"),
                movies = dao.catalogCountAll(staged.id, "movie"),
                series = dao.catalogCountAll(staged.id, "series")
            )
            // A website host/credential change for the same playlist must not be allowed to replace
            // a known-good 50k/100k library with a truncated but syntactically valid response.
            if (!CatalogRefreshIntegrityPolicy.accepts(previousCounts, candidateCounts)) {
                // Valid-looking truncated server replies are not safe to resume indefinitely.
                checkpoint.discard(saved, dao)
                return Result.retry()
            }

            setProgress(androidx.work.workDataOf("catalog_stage" to "SAVE"))
            val refreshedProvider = refreshSource.copy(enabled = true, updatedAt = staged.updatedAt)
            currentCoroutineContext().ensureActive()
            if (CatalogPlaybackGate.isPlaying) throw PlaybackInProgressException()
            // Only the atomic final promotion shares the foreground import lock. This avoids
            // a background download making Login/CatalogLoading wait before opening old cache.
            CatalogLoadPersistence.withProviderLock(provider.id) {
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
            }

            // Promotion is the durable result. Do not immediately rebuild Home/FTS/manifest here;
            // CatalogEnrichmentLifecycle owns that work after its UI quiet period so Room/CPU do not
            // compete with the user just after opening Home.
            Result.success()
        } catch (_: PlaybackInProgressException) {
            // The viewer is watching; retry quietly later with the committed catalog unchanged.
            Result.retry()
        } catch (_: TimeoutCancellationException) {
            // A provider timeout is retryable; a cancelled Worker must still stop immediately.
            currentCoroutineContext().ensureActive()
            if (promoted) Result.success() else Result.retry()
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (_: Exception) {
            if (promoted) Result.success() else Result.retry()
        } finally {
            // On a timeout/cancellation/temporary error keep the *staged* completed sections.
            // Incomplete streamed sections are cleared and retried on the next worker run.
            if (promoted) checkpoint.finish(saved)
        }
    }

    companion object {
        private val workerLocks = ConcurrentHashMap<String, Mutex>()
        private const val KEY_PROVIDER_ID = "provider_id"
        private const val LEGACY_PERIODIC_NAME = "blofy-catalog-periodic"
        private const val NOW_NAME_PREFIX = "blofy-catalog-now:"
        private const val MANUAL_NAME_PREFIX = "blofy-catalog-manual:"
        private const val KEY_MANUAL = "manual"

        fun manualWorkName(providerId: String): String = MANUAL_NAME_PREFIX + providerId
        // Keep the existing unique name so UPDATE replaces the old 24-hour schedule.
        private const val AUTO_PERIODIC_NAME = "blofy-catalog-auto-24h"

        private val constraints = Constraints.Builder()
            .setRequiredNetworkType(NetworkType.CONNECTED)
            .setRequiresStorageNotLow(true)
            .build()

        fun cancelLegacyAutomatic(context: Context) {
            WorkManager.getInstance(context.applicationContext).cancelUniqueWork(LEGACY_PERIODIC_NAME)
        }

        /**
         * One active provider is checked about every 30 minutes when system conditions allow.
         * Actual runs can be deferred by Android or while the viewer is playing video.
         */
        fun scheduleAutomatic(context: Context, providerId: String) {
            if (providerId.isBlank()) return
            val request = PeriodicWorkRequestBuilder<CatalogRefreshWorker>(
                CatalogAutoRefreshPolicy.INTERVAL_MINUTES, TimeUnit.MINUTES
            )
                .setConstraints(constraints)
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 10, TimeUnit.MINUTES)
                .setInputData(androidx.work.workDataOf(KEY_PROVIDER_ID to providerId, KEY_MANUAL to false))
                .build()
            WorkManager.getInstance(context.applicationContext).enqueueUniquePeriodicWork(
                AUTO_PERIODIC_NAME, ExistingPeriodicWorkPolicy.UPDATE, request
            )
        }

        fun enqueueIfStale(context: Context, providerId: String) {
            if (CatalogAutoRefreshPolicy.isDue(
                    CatalogSyncState.lastSyncedAt(context, providerId), System.currentTimeMillis()
                )
            ) enqueueNow(context, providerId, manual = false)
        }

        fun enqueueNow(context: Context, providerId: String, manual: Boolean = true) {
            if (providerId.isBlank()) return
            val request = OneTimeWorkRequestBuilder<CatalogRefreshWorker>()
                .setConstraints(constraints)
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 20, TimeUnit.SECONDS)
                .setInputData(androidx.work.workDataOf(KEY_PROVIDER_ID to providerId, KEY_MANUAL to manual))
                .build()
            WorkManager.getInstance(context.applicationContext).enqueueUniqueWork(
                if (manual) manualWorkName(providerId) else NOW_NAME_PREFIX + providerId,
                ExistingWorkPolicy.KEEP,
                request
            )
        }
    }
}

internal suspend fun discardStagedCatalogSafely(dao: BlofyDao, stagedProviderId: String) {
    withContext(NonCancellable + Dispatchers.IO) { dao.discardStagedCatalog(stagedProviderId) }
}
