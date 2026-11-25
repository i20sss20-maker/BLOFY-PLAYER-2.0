package tv.blofy.player.data

import android.content.Context
import androidx.work.Constraints
import androidx.work.ExistingWorkPolicy
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.workDataOf
import androidx.work.BackoffPolicy
import kotlinx.coroutines.withTimeoutOrNull
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import kotlinx.coroutines.CancellationException
import tv.blofy.player.core.identity.NativeExternalCatalogSession
import tv.blofy.player.core.identity.NativeExternalMediaTransport
import java.util.concurrent.TimeUnit

/** External providers have no BLOFY delta API. Run a bounded full refresh off
 * the playback path, preserve the committed library on errors. QA only. */
class NativeExternalCatalogRefreshWorker(context: Context, params: WorkerParameters) :
    CoroutineWorker(context,params) {
    override suspend fun doWork(): Result {
        val app = applicationContext
        if (!NativeExternalCatalogSession.qaEnabled(app) || !CatalogAutoRefreshPolicy.isEnabled(app))
            return Result.success()
        if (CatalogPlaybackGate.isPlaying) return Result.retry()
        return try {
            val id = NativeExternalCatalogSession.activeId(app) ?: return Result.success()
            val repairId = inputData.getString("repair_provider")
            if (repairId != null && (repairId != id || !needsArtworkRepair(app,id))) return Result.success()
            val completed = withTimeoutOrNull(CatalogAutoRefreshPolicy.MAX_SINGLE_SYNC_MS) {
                NativeExternalCatalogSession.refresh(app) {
                    if (CatalogPlaybackGate.isPlaying) throw PlaybackInProgressException()
                }
            }
            if (completed == null) Result.retry() else Result.success()
        } catch (_: PlaybackInProgressException) { Result.retry() }
        catch (cancelled: CancellationException) { throw cancelled }
        catch (_: Exception) { Result.retry() }
    }

    companion object {
        private const val NAME = "blofy-native-external-catalog-refresh"
        private const val REPAIR = "blofy-native-external-artwork-repair"
        private const val ARTWORK_REVISION = 1

        private fun state(context: Context) =
            context.applicationContext.getSharedPreferences("blofy_external_artwork_revision", Context.MODE_PRIVATE)

        internal fun needsArtworkRepair(context: Context, providerId: String): Boolean =
            state(context).getInt(providerId,0) < ARTWORK_REVISION

        internal fun markArtworkReady(context: Context, providerId: String) {
            state(context).edit().putInt(providerId,ARTWORK_REVISION).apply()
        }

        internal fun clearArtworkState(context: Context, providerId: String) {
            state(context).edit().remove(providerId).apply()
        }

        fun schedule(context: Context, providerId: String) {
            if (!NativeExternalCatalogSession.qaEnabled(context) ||
                !NativeExternalMediaTransport.isExternal(providerId)) return
            if (!CatalogAutoRefreshPolicy.isEnabled(context)) return
            if (needsArtworkRepair(context,providerId)) {
                val repair = OneTimeWorkRequestBuilder<NativeExternalCatalogRefreshWorker>()
                    .setInputData(workDataOf("repair_provider" to providerId))
                    .setInitialDelay(30,TimeUnit.SECONDS)
                    .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED)
                        .setRequiresStorageNotLow(true).build())
                    .setBackoffCriteria(BackoffPolicy.EXPONENTIAL,10,TimeUnit.MINUTES)
                    .build()
                WorkManager.getInstance(context.applicationContext)
                    .enqueueUniqueWork(REPAIR,ExistingWorkPolicy.KEEP,repair)
            }
            val request = PeriodicWorkRequestBuilder<NativeExternalCatalogRefreshWorker>(1,TimeUnit.HOURS)
                .setInitialDelay(1,TimeUnit.HOURS)
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED)
                    .setRequiresStorageNotLow(true).build())
                .build()
            WorkManager.getInstance(context.applicationContext)
                .enqueueUniquePeriodicWork(NAME,ExistingPeriodicWorkPolicy.KEEP,request)
        }
        fun cancel(context: Context) {
            WorkManager.getInstance(context.applicationContext).cancelUniqueWork(NAME)
            WorkManager.getInstance(context.applicationContext).cancelUniqueWork(REPAIR)
        }
    }
}
