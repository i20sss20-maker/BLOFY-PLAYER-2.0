package tv.blofy.player.data

import android.content.Context
import androidx.work.Constraints
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
            if (NativeExternalCatalogSession.activeId(app) == null) return Result.success()
            NativeExternalCatalogSession.refresh(app)
            Result.success()
        } catch (cancelled: CancellationException) { throw cancelled }
        catch (_: Exception) { Result.retry() }
    }

    companion object {
        private const val NAME = "blofy-native-external-catalog-refresh"
        fun schedule(context: Context, providerId: String) {
            if (!NativeExternalCatalogSession.qaEnabled(context) ||
                !NativeExternalMediaTransport.isExternal(providerId)) return
            val request = PeriodicWorkRequestBuilder<NativeExternalCatalogRefreshWorker>(1,TimeUnit.HOURS)
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .build()
            WorkManager.getInstance(context.applicationContext)
                .enqueueUniquePeriodicWork(NAME,ExistingPeriodicWorkPolicy.KEEP,request)
        }
        fun cancel(context: Context) {
            WorkManager.getInstance(context.applicationContext).cancelUniqueWork(NAME)
        }
    }
}
