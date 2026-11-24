package tv.blofy.player.ui.series

import android.content.Context
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import kotlinx.coroutines.CancellationException
import tv.blofy.player.BuildConfig
import tv.blofy.player.data.CatalogAutoRefreshPolicy
import tv.blofy.player.data.CatalogPlaybackGate
import tv.blofy.player.data.CatalogSyncState
import tv.blofy.player.data.PlaylistManager
import tv.blofy.player.data.local.BlofyDatabase
import java.util.concurrent.TimeUnit

/**
 * Quietly discovers new episodes in a few recently watched series on entry.
 * Never fetches video bytes, never opens UI and never runs the huge first-import
 * metadata/artwork crawler. Series not watched yet still refresh on opening.
 */
class RecentEpisodesRefreshWorker(appContext: Context, params: WorkerParameters) :
    CoroutineWorker(appContext, params) {

    override suspend fun doWork(): Result {
        val app = applicationContext
        if (!BuildConfig.CODE_ONLY_LOGIN || !CatalogAutoRefreshPolicy.isEnabled(app))
            return Result.success()
        val providerId = inputData.getString(KEY_PROVIDER_ID).orEmpty()
        if (providerId.isBlank() || !CatalogSyncState.isReady(app, providerId))
            return Result.success()
        if (CatalogPlaybackGate.isPlaying) return Result.retry()

        val dao = BlofyDatabase.get(app).dao()
        val activeId = dao.activeProviderId()
        if (activeId != providerId) return Result.success()
        val provider = dao.provider(providerId) ?: return Result.success()
        val recentlyWatched = dao.recentWatchStates(providerId, 50)
        val seriesIds = linkedSetOf<String>()
        for (item in recentlyWatched) {
            if (item.kind != "episode") continue
            val episode = dao.episode(item.contentKey) ?: continue
            if (episode.providerId != providerId || episode.seriesId.isBlank()) continue
            seriesIds.add(episode.seriesId)
            if (seriesIds.size >= MAX_SERIES_PER_RUN) break
        }
        val manager = try { PlaylistManager.forProvider(app, provider, dao, episodeRequest = true) }
            catch (_: Exception) { return Result.retry() }
        for (seriesId in seriesIds) {
            if (CatalogPlaybackGate.isPlaying) return Result.retry()
            if (!SeriesEpisodeRefreshPolicy.claim(app, providerId, seriesId)) continue
            try {
                val result = manager.syncSeriesEpisodes(provider, seriesId, preserveCachedRows = true)
                if (result.cacheUpdated && result.episodeCount > 0) {
                    SeriesEpisodeRefreshPolicy.markSuccess(app, providerId, seriesId)
                }
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (_: Exception) {
                // Preserve the local episodes; a later entry may retry this title.
                // Do not let one failing upstream title block the others.
            }
        }
        return Result.success()
    }

    companion object {
        private const val KEY_PROVIDER_ID = "provider_id"
        private const val PREFS = "blofy_stream_recent_episodes_auto_v1"
        internal const val MAX_SERIES_PER_RUN = 5
        internal const val ENTRY_GAP_MS = 4L * 60L * 60_000L
        private const val UNIQUE_PREFIX = "blofy-stream-recent-episodes:"

        internal fun due(lastScheduledAt: Long, nowMs: Long): Boolean =
            lastScheduledAt <= 0L ||
                (nowMs >= lastScheduledAt && nowMs - lastScheduledAt >= ENTRY_GAP_MS)

        fun enqueueIfDue(context: Context, providerId: String) {
            if (!BuildConfig.CODE_ONLY_LOGIN || providerId.isBlank() ||
                !CatalogAutoRefreshPolicy.isEnabled(context)) return
            val app = context.applicationContext
            val prefs = app.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            val key = "scheduled:$providerId"
            val now = System.currentTimeMillis()
            synchronized(this) {
                if (!due(prefs.getLong(key, 0L), now)) return
                if (!prefs.edit().putLong(key, now).commit()) return
            }
            val constraints = Constraints.Builder()
                .setRequiredNetworkType(NetworkType.CONNECTED)
                .setRequiresStorageNotLow(true)
                .build()
            val request = OneTimeWorkRequestBuilder<RecentEpisodesRefreshWorker>()
                .setInputData(workDataOf(KEY_PROVIDER_ID to providerId))
                .setConstraints(constraints)
                .setInitialDelay(10, TimeUnit.SECONDS)
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.MINUTES)
                .build()
            WorkManager.getInstance(app).enqueueUniqueWork(
                UNIQUE_PREFIX + providerId, ExistingWorkPolicy.KEEP, request)
        }
    }
}
