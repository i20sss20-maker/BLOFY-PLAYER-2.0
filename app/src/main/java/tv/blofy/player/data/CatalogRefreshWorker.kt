package tv.blofy.player.data

import android.content.Context
import tv.blofy.player.BuildConfig
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingWorkPolicy
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.workDataOf
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
        // STREAM auto-sync is opt-out, daily and Wi-Fi/unmetered only. Never
        // start hidden downloads on devices where the viewer disabled it.
        if (BuildConfig.CODE_ONLY_LOGIN && !manual &&
            !CatalogAutoRefreshPolicy.streamEnabled(app)) return Result.success()
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
            // Bound user-triggered jobs: do not display an endless waiting animation.
            retryOrFail(inputData.getBoolean(KEY_MANUAL, false), "LOCAL")
        }
    }

    private suspend fun refreshCatalog(provider: ProviderEntity, dao: BlofyDao, manual: Boolean): Result {
        val app = applicationContext
        // A first import writes batches before it commits; those rows are not a refresh baseline.
        if (!CatalogSyncState.isReady(app, provider.id) || !dao.hasCatalog(provider.id)) return Result.success()

        val sourceChanged = PortalSyncBook.hasPendingSource(app, provider.id)
        // Only an explicitly approved user action may switch the Xtream
        // source/credentials; automatic sync updates the CURRENT source only.
        if (!manual && sourceChanged) return Result.success()
        if (!manual && !CatalogAutoRefreshPolicy.isDue(
                CatalogSyncState.lastSyncedAt(app, provider.id),
                System.currentTimeMillis(),
                if (BuildConfig.CODE_ONLY_LOGIN) CatalogAutoRefreshPolicy.STREAM_MINIMUM_GAP_MS
                else CatalogAutoRefreshPolicy.MINIMUM_GAP_MS
            )
        ) return Result.success()
        // A streaming player must not compete with a full-library download/SQLite promotion.
        if (CatalogPlaybackGate.isPlaying) {
            setProgress(workDataOf(KEY_STAGE to "PAUSED", KEY_PERCENT to 0))
            return retryOrFail(manual, "PLAYBACK")
        }
        val refreshSource = if (sourceChanged) {
            PortalPlaylistClient.pendingSource(app, dao, provider.id) ?: return Result.retry()
        } else provider

        val previousCounts = CatalogRefreshIntegrityPolicy.Counts(
            live = dao.catalogCountAll(provider.id, "live"),
            movies = dao.catalogCountAll(provider.id, "movie"),
            series = dao.catalogCountAll(provider.id, "series")
        )

        if (!LocalStorageManager.prepareForCatalogRefresh(app)) {
            return if (manual) Result.failure(workDataOf(KEY_ERROR to "STORAGE")) else Result.retry()
        }

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
        var lastPercent = checkpoint.percent(saved)
        var lastStage = "START"
        var lastRetry = -1
        suspend fun publish(stage: String, attemptedPercent: Int, attempt: Int = 0) {
            val previous = lastPercent
            val percent = maxOf(lastPercent, attemptedPercent)
                .coerceIn(0, CatalogRefreshProgress.COMMIT_START)
            if (percent > lastPercent) {
                lastPercent = checkpoint.recordPercent(saved, percent)
            }
            // Do not write WorkManager's database for every JSON row. The visible
            // percentage comes from measured section progress and never counts backwards.
            if (stage != lastStage || lastPercent != previous || attempt != lastRetry) {
                lastStage = stage
                lastRetry = attempt
                setProgress(workDataOf(KEY_STAGE to stage, KEY_PERCENT to lastPercent, KEY_RETRY to attempt))
            }
        }
        setProgress(workDataOf(KEY_STAGE to "START", KEY_PERCENT to lastPercent,
            KEY_RETRY to runAttemptCount))
        return try {
            val sync = PlaylistSyncPolicy.run(CatalogAutoRefreshPolicy.MAX_SINGLE_SYNC_MS) {
                PlaylistManager(XtreamClient.api, dao).syncAll(
                    staged,
                    completedSections = saved.completed,
                    onSectionComplete = { kind ->
                        checkpoint.completed(saved, kind, dao)
                        publish(when (kind) {
                            "live" -> "LIVE"
                            "movie" -> "MOVIES"
                            else -> "SERIES"
                        }, CatalogRefreshProgress.afterSection(kind))
                    },
                    onProgress = { progress ->
                        if (CatalogPlaybackGate.isPlaying) throw PlaybackInProgressException()
                        publish(progress.stage.name, CatalogRefreshProgress.forSection(progress),
                            progress.retryAttempt)
                    }
                )
            }
            if (sync.failedSectionCount > 0) {
                // PlaylistManager already retries each incomplete response.
                // A manual update must not silently sit at ~90% through four
                // more WorkManager runs; retain the staged verified sections.
                return if (manual) Result.failure(workDataOf(
                    KEY_ERROR to "INCOMPLETE", KEY_STAGE to lastStage,
                    KEY_PERCENT to lastPercent
                )) else Result.retry()
            }
            if (sync.freshItemCount <= 0) {
                // A zero-item Xtream reply must never replace the known-good catalog.
                checkpoint.discard(saved, dao)
                return if (manual) Result.failure(workDataOf(KEY_ERROR to "EMPTY")) else Result.retry()
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
                return if (manual) Result.failure(workDataOf(KEY_ERROR to "INTEGRITY")) else Result.retry()
            }

            publish("SAVE", CatalogRefreshProgress.COMMIT_START)
            val refreshedProvider = refreshSource.copy(enabled = true, updatedAt = staged.updatedAt)
            currentCoroutineContext().ensureActive()
            if (CatalogPlaybackGate.isPlaying) throw PlaybackInProgressException()
            // Only the atomic final promotion shares the foreground import lock. Keep the
            // previously committed catalog accessible and bound the 95% finalization: both
            // same-source and approved pending-source paths use a cancellation-safe deadline.
            CatalogLoadPersistence.withProviderLock(provider.id) {
                if (sourceChanged) {
                    PortalPlaylistClient.commitPendingSource(app, dao, refreshSource) {
                        CatalogRefreshCommitPolicy.run {
                            dao.promoteStagedBackgroundRefresh(staged.id, provider, refreshedProvider)
                            promoted = true
                            runCatching { CatalogSyncState.markSourceReplaced(app, provider.id) }
                        }
                    }
                } else {
                    CatalogRefreshCommitPolicy.run {
                        dao.promoteStagedBackgroundRefresh(staged.id, provider, refreshedProvider)
                        promoted = true
                        runCatching { CatalogSyncState.markCatalogCommitted(app, provider.id) }
                    }
                }
            }

            // Promotion is the durable result. Do not immediately rebuild Home/FTS/manifest here;
            // CatalogEnrichmentLifecycle owns that work after its UI quiet period so Room/CPU do not
            // compete with the user just after opening Home.
            setProgress(workDataOf(KEY_STAGE to "DONE", KEY_PERCENT to 100))
            Result.success()
        } catch (_: PlaybackInProgressException) {
            // The viewer is watching; retry quietly later with the committed catalog unchanged.
            retryOrFail(manual, "PLAYBACK")
        } catch (_: TimeoutCancellationException) {
            // A provider timeout is retryable; a cancelled Worker must still stop immediately.
            // Once all three remote sections reached 95%, an expensive local commit that
            // timed out should fail visibly on manual refresh, not silently retry for ~24 min.
            // Keep the old committed catalog and staged checkpoint for a later user retry.
            currentCoroutineContext().ensureActive()
            when {
                promoted -> Result.success()
                CatalogRefreshCommitPolicy.shouldFailManualCommitTimeout(manual, lastStage) ->
                    Result.failure(workDataOf(KEY_ERROR to "COMMIT_TIMEOUT", KEY_STAGE to lastStage,
                        KEY_PERCENT to lastPercent))
                manual -> Result.failure(workDataOf(KEY_ERROR to "SOURCE_TIMEOUT",
                    KEY_STAGE to lastStage, KEY_PERCENT to lastPercent))
                else -> retryOrFail(manual, "TIMEOUT")
            }
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (_: Exception) {
            when {
                promoted -> Result.success()
                manual && lastStage == "SERIES" ->
                    // Xtream already attempted bounded source retries. Do not
                    // send users through four more 90% loops with no diagnosis.
                    Result.failure(workDataOf(KEY_ERROR to "SERIES_INTERRUPTED",
                        KEY_STAGE to lastStage, KEY_PERCENT to lastPercent))
                else -> retryOrFail(manual, "NETWORK")
            }
        } finally {
            // On a timeout/cancellation/temporary error keep the *staged* completed sections.
            // Incomplete streamed sections are cleared and retried on the next worker run.
            if (promoted) checkpoint.finish(saved)
        }
    }

    private fun retryOrFail(manual: Boolean, reason: String): Result =
        if (manual && runAttemptCount >= MAX_MANUAL_RETRIES)
            Result.failure(workDataOf(KEY_ERROR to reason))
        else Result.retry()

    companion object {
        internal const val KEY_STAGE = "catalog_stage"
        internal const val KEY_PERCENT = "catalog_percent"
        internal const val KEY_RETRY = "catalog_retry"
        internal const val KEY_ERROR = "catalog_error"
        private const val MAX_MANUAL_RETRIES = 4
        private val workerLocks = ConcurrentHashMap<String, Mutex>()
        private const val KEY_PROVIDER_ID = "provider_id"
        private const val LEGACY_PERIODIC_NAME = "blofy-catalog-periodic"
        private const val NOW_NAME_PREFIX = "blofy-catalog-now:"
        private const val MANUAL_NAME_PREFIX = "blofy-catalog-manual:"
        private const val KEY_MANUAL = "manual"

        fun manualWorkName(providerId: String): String = MANUAL_NAME_PREFIX + providerId
        // Keep the existing unique name so UPDATE replaces the old 24-hour schedule.
        private const val AUTO_PERIODIC_NAME = "blofy-catalog-auto-24h"
        private const val STREAM_PERIODIC_NAME = "blofy-stream-catalog-daily"
        private const val STREAM_SCHEDULE_PREFS = "blofy_stream_catalog_schedule_v1"
        private const val STREAM_PROVIDER_KEY = "provider_id"

        private val constraints = Constraints.Builder()
            .setRequiredNetworkType(NetworkType.CONNECTED)
            .setRequiresStorageNotLow(true)
            .build()
        private val streamAutoConstraints = Constraints.Builder()
            .setRequiredNetworkType(NetworkType.UNMETERED)
            .setRequiresStorageNotLow(true)
            .build()

        // Foreground manual clicks must not wait forever behind WorkManager's
        // storage-not-low constraint. The worker performs its own explicit storage
        // preflight and returns a visible failure without touching saved rows.
        private val manualConstraints = Constraints.Builder()
            .setRequiredNetworkType(NetworkType.CONNECTED)
            .build()

        /** Cancel pre-upgrade STREAM auto jobs without touching explicit user updates. */
        private fun cancelStreamAutomatic(context: Context, providerId: String) {
            val work = WorkManager.getInstance(context.applicationContext)
            work.cancelUniqueWork(LEGACY_PERIODIC_NAME)
            work.cancelUniqueWork(AUTO_PERIODIC_NAME)
            work.cancelUniqueWork(NOW_NAME_PREFIX + providerId)
            work.cancelUniqueWork(STREAM_PERIODIC_NAME)
        }

        fun cancelLegacyAutomatic(context: Context) {
            WorkManager.getInstance(context.applicationContext).cancelUniqueWork(LEGACY_PERIODIC_NAME)
        }

        /**
         * STREAM: once daily on Wi-Fi/unmetered, idle from playback, only the active
         * provider. WorkManager may defer on TVs; it is not an exact alarm.
         * PLAYER retains its previous 30-minute policy and unique name.
         */
        fun scheduleAutomatic(context: Context, providerId: String) {
            if (providerId.isBlank()) return
            val app = context.applicationContext
            val work = WorkManager.getInstance(app)
            val stream = BuildConfig.CODE_ONLY_LOGIN
            if (stream) {
                // Retire old 30-min jobs once after upgrade; never cancel the
                // new daily job on every Home resume.
                work.cancelUniqueWork(LEGACY_PERIODIC_NAME)
                work.cancelUniqueWork(AUTO_PERIODIC_NAME)
                work.cancelUniqueWork(NOW_NAME_PREFIX + providerId)
                val prefs = app.getSharedPreferences(STREAM_SCHEDULE_PREFS, Context.MODE_PRIVATE)
                val previous = prefs.getString(STREAM_PROVIDER_KEY, null)
                if (!CatalogAutoRefreshPolicy.streamEnabled(app)) {
                    work.cancelUniqueWork(STREAM_PERIODIC_NAME)
                    return
                }
                if (previous != providerId) {
                    work.cancelUniqueWork(STREAM_PERIODIC_NAME)
                    check(prefs.edit().putString(STREAM_PROVIDER_KEY, providerId).commit()) {
                        "Unable to save automatic sync provider"
                    }
                }
            }
            val request = PeriodicWorkRequestBuilder<CatalogRefreshWorker>(
                if (stream) CatalogAutoRefreshPolicy.STREAM_INTERVAL_MINUTES
                else CatalogAutoRefreshPolicy.INTERVAL_MINUTES,
                TimeUnit.MINUTES
            )
                .setConstraints(if (stream) streamAutoConstraints else constraints)
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 10, TimeUnit.MINUTES)
                .setInputData(androidx.work.workDataOf(KEY_PROVIDER_ID to providerId, KEY_MANUAL to false))
                .build()
            work.enqueueUniquePeriodicWork(
                if (stream) STREAM_PERIODIC_NAME else AUTO_PERIODIC_NAME,
                if (stream) ExistingPeriodicWorkPolicy.KEEP else ExistingPeriodicWorkPolicy.UPDATE,
                request
            )
        }

        fun enqueueIfStale(context: Context, providerId: String) {
            // STREAM's scheduled periodic job already checks last successful sync;
            // a second Home-triggered one-time job would duplicate downloads.
            if (BuildConfig.CODE_ONLY_LOGIN) return
            if (CatalogAutoRefreshPolicy.isDue(
                    CatalogSyncState.lastSyncedAt(context, providerId), System.currentTimeMillis()
                )
            ) enqueueNow(context, providerId, manual = false)
        }

        fun enqueueNow(context: Context, providerId: String, manual: Boolean = true) {
            if (providerId.isBlank() || (BuildConfig.CODE_ONLY_LOGIN && !manual)) return
            val request = OneTimeWorkRequestBuilder<CatalogRefreshWorker>()
                .setConstraints(if (manual) manualConstraints else constraints)
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 20, TimeUnit.SECONDS)
                .setInputData(androidx.work.workDataOf(KEY_PROVIDER_ID to providerId, KEY_MANUAL to manual))
                .build()
            WorkManager.getInstance(context.applicationContext).enqueueUniqueWork(
                if (manual) manualWorkName(providerId) else NOW_NAME_PREFIX + providerId,
                if (manual && !BuildConfig.CODE_ONLY_LOGIN) ExistingWorkPolicy.REPLACE else ExistingWorkPolicy.KEEP,
                request
            )
        }
    }
}

internal suspend fun discardStagedCatalogSafely(dao: BlofyDao, stagedProviderId: String) {
    withContext(NonCancellable + Dispatchers.IO) { dao.discardStagedCatalog(stagedProviderId) }
}
