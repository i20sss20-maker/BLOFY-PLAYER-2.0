package tv.blofy.player.data

import android.content.Context
import com.google.gson.Gson
import tv.blofy.player.data.local.BlofyDao
import tv.blofy.player.data.local.BlofyDatabase
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
        val fullyReady: Boolean,
        val entryReady: Boolean = false,
        val catalogEpoch: Long = 0L
    )

    fun read(context: Context, providerId: String): Manifest? {
        val raw = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(providerId, null) ?: return null
        return runCatching { gson.fromJson(raw, Manifest::class.java) }.getOrNull()
    }

    suspend fun rebuild(context: Context, dao: BlofyDao, provider: ProviderEntity, completionVerified: Boolean = false, entryVerified: Boolean = false) {
        val db = BlofyDatabase.get(context.applicationContext).openHelper.readableDatabase
        val episodeCount = db.query("SELECT COUNT(*) FROM episodes WHERE providerId = ?", arrayOf(provider.id)).use { cursor ->
            if (cursor.moveToFirst()) cursor.getInt(0) else 0
        }
        val manifest = Manifest(
            providerId = provider.id,
            generatedAt = System.currentTimeMillis(),
            liveCount = dao.catalogCountAll(provider.id, "live"),
            movieCount = dao.catalogCountAll(provider.id, "movie"),
            seriesCount = dao.catalogCountAll(provider.id, "series"),
            episodeCount = episodeCount,
            metadataCount = ProviderMetadataCache.count(context, provider.id),
            fullyReady = completionVerified,
            entryReady = entryVerified || CatalogSyncState.isEntryReady(context, provider.id),
            catalogEpoch = CatalogSyncState.lastUpdatedAt(context, provider.id)
        )
        check(context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(provider.id, gson.toJson(manifest)).commit()) { "Unable to persist catalog manifest" }
    }

    fun clear(context: Context, providerId: String) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().remove(providerId).apply()
    }
}
