package tv.blofy.player.data

import android.content.Context
import com.google.gson.Gson
import tv.blofy.player.data.local.BlofyDao
import tv.blofy.player.data.local.ProviderEntity
import tv.blofy.player.data.metadata.ProviderMetadataCache

/** Compact audit record proving what was persisted by the one-time full sync. */
object CatalogManifestStore {
    private const val PREFS = "blofy_catalog_manifest_v1"
    private val gson = Gson()

    data class Manifest(
        val providerId: String,
        val generatedAt: Long,
        val liveCount: Int,
        val movieCount: Int,
        val seriesCount: Int,
        val episodeCount: Int,
        val metadataCount: Int,
        val fullyReady: Boolean
    )

    fun read(context: Context, providerId: String): Manifest? {
        val raw = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(providerId, null) ?: return null
        return runCatching { gson.fromJson(raw, Manifest::class.java) }.getOrNull()
    }

    suspend fun rebuild(context: Context, dao: BlofyDao, provider: ProviderEntity) {
        val manifest = Manifest(
            providerId = provider.id,
            generatedAt = System.currentTimeMillis(),
            liveCount = dao.catalogCountAll(provider.id, "live"),
            movieCount = dao.catalogCountAll(provider.id, "movie"),
            seriesCount = dao.catalogCountAll(provider.id, "series"),
            episodeCount = dao.episodeCountForProvider(provider.id),
            metadataCount = ProviderMetadataCache.count(context, provider.id),
            fullyReady = CatalogSyncState.isFullyReady(context, provider.id)
        )
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(provider.id, gson.toJson(manifest)).apply()
    }

    fun clear(context: Context, providerId: String) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().remove(providerId).apply()
    }
}
