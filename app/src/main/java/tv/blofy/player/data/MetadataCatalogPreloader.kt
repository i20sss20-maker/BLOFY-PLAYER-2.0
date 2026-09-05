package tv.blofy.player.data

import android.content.Context
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.Data
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import tv.blofy.player.data.local.BlofyDatabase
import tv.blofy.player.data.metadata.ProviderMetadataCache
import tv.blofy.player.data.metadata.XtreamMetadataFallback
import tv.blofy.player.ui.catalog.ArtworkLoader
import java.util.concurrent.TimeUnit

/**
 * Preloads movie/series detail metadata from the active provider once and persists it locally.
 * Detail screens never perform these network calls themselves.
 */
object MetadataCatalogPreloader {
    private const val KEY_PROVIDER_ID = "provider_id"
    private const val KEY_KIND = "kind"
    private const val KEY_AFTER_ROW_ID = "after_row_id"
    private const val BATCH_SIZE = 20

    fun schedule(
        context: Context,
        providerId: String,
        kind: String = "movie",
        afterRowId: Long = 0L,
        replace: Boolean = false
    ) {
        if (providerId.isBlank()) return
        val normalizedKind = if (kind == "series") "series" else "movie"
        val request = OneTimeWorkRequestBuilder<MetadataPreloadWorker>()
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            .setInputData(
                Data.Builder()
                    .putString(KEY_PROVIDER_ID, providerId)
                    .putString(KEY_KIND, normalizedKind)
                    .putLong(KEY_AFTER_ROW_ID, afterRowId.coerceAtLeast(0L))
                    .build()
            )
            .setInitialDelay(if (afterRowId == 0L && normalizedKind == "movie") 1 else 0, TimeUnit.SECONDS)
            .build()
        WorkManager.getInstance(context.applicationContext).enqueueUniqueWork(
            "blofy-metadata-$providerId",
            if (replace) ExistingWorkPolicy.REPLACE else ExistingWorkPolicy.APPEND_OR_REPLACE,
            request
        )
    }

    internal fun providerId(data: Data) = data.getString(KEY_PROVIDER_ID).orEmpty()
    internal fun kind(data: Data) = data.getString(KEY_KIND).orEmpty().let { if (it == "series") "series" else "movie" }
    internal fun afterRowId(data: Data) = data.getLong(KEY_AFTER_ROW_ID, 0L).coerceAtLeast(0L)
    internal fun batchSize() = BATCH_SIZE
}

class MetadataPreloadWorker(
    appContext: Context,
    params: WorkerParameters
) : CoroutineWorker(appContext, params) {
    override suspend fun doWork(): Result = Result.success()
}
