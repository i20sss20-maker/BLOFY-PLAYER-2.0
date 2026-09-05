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
    override suspend fun doWork(): Result {
        val providerId = MetadataCatalogPreloader.providerId(inputData)
        if (providerId.isBlank()) return Result.failure()
        val dao = BlofyDatabase.get(applicationContext).dao()
        val provider = dao.provider(providerId) ?: return Result.success()

        if (provider.providerType.equals("m3u", true)) {
            CatalogSyncState.markMetadataReady(applicationContext, providerId)
            return Result.success()
        }
        if (!CatalogSyncState.isReady(applicationContext, providerId)) return Result.retry()

        val kind = MetadataCatalogPreloader.kind(inputData)
        val afterRowId = MetadataCatalogPreloader.afterRowId(inputData)
        val page = dao.catalogPageAfterAll(providerId, kind, afterRowId, MetadataCatalogPreloader.batchSize())

        if (page.isEmpty()) {
            if (kind == "movie") {
                MetadataCatalogPreloader.schedule(applicationContext, providerId, "series", 0L)
            } else {
                CatalogSyncState.markMetadataReady(applicationContext, providerId)
            }
            return Result.success()
        }

        for (stream in page) {
            if (isStopped) return Result.success()
            if (ProviderMetadataCache.contains(applicationContext, stream.key)) continue
            val metadata = runCatching {
                if (kind == "series") XtreamMetadataFallback.fetchSeries(provider, stream)
                else XtreamMetadataFallback.fetchMovie(provider, stream)
            }.getOrNull()
            // Even a valid "no extra metadata" response gets a marker so page opening never causes
            // a retry loop. A future explicit refresh can clear/rebuild this cache if desired.
            ProviderMetadataCache.write(applicationContext, providerId, stream.key, metadata)
        }

        val nextRowId = dao.streamRowId(page.last().key) ?: return Result.success()
        MetadataCatalogPreloader.schedule(applicationContext, providerId, kind, nextRowId)
        return Result.success()
    }
}
