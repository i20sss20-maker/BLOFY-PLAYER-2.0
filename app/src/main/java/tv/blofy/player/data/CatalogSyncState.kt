package tv.blofy.player.data

import android.content.Context

/** Stores catalog readiness and the last successful refresh time per provider. */
object CatalogSyncState {
    private const val PREFS = "blofy_catalog_sync_state"
    private const val READY_PREFIX = "ready:"
    private const val METADATA_READY_PREFIX = "metadata_ready:"
    private const val EPISODES_READY_PREFIX = "episodes_ready:"
    private const val UPDATED_PREFIX = "updated:"

    fun isReady(context: Context, providerId: String): Boolean =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .getBoolean(READY_PREFIX + providerId, false)

    fun isMetadataReady(context: Context, providerId: String): Boolean =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .getBoolean(METADATA_READY_PREFIX + providerId, false)

    fun areEpisodesReady(context: Context, providerId: String): Boolean =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .getBoolean(EPISODES_READY_PREFIX + providerId, false)

    fun isFullyReady(context: Context, providerId: String): Boolean =
        isReady(context, providerId) && isMetadataReady(context, providerId) && areEpisodesReady(context, providerId)

    fun lastUpdatedAt(context: Context, providerId: String): Long =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .getLong(UPDATED_PREFIX + providerId, 0L)

    fun lastSyncedAt(context: Context, providerId: String): Long = lastUpdatedAt(context, providerId)

    fun markPending(context: Context, providerId: String) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit()
            .putBoolean(READY_PREFIX + providerId, false)
            .putBoolean(METADATA_READY_PREFIX + providerId, false)
            .putBoolean(EPISODES_READY_PREFIX + providerId, false)
            .apply()
    }

    fun markReady(context: Context, providerId: String) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit()
            .putBoolean(READY_PREFIX + providerId, true)
            .putBoolean(METADATA_READY_PREFIX + providerId, false)
            .putBoolean(EPISODES_READY_PREFIX + providerId, false)
            .putLong(UPDATED_PREFIX + providerId, System.currentTimeMillis())
            .apply()
        EpisodeCatalogPreloader.schedule(context.applicationContext, providerId, replace = true)
        MetadataCatalogPreloader.schedule(context.applicationContext, providerId, replace = true)
    }

    fun markMetadataReady(context: Context, providerId: String) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit().putBoolean(METADATA_READY_PREFIX + providerId, true).apply()
    }

    fun markEpisodesReady(context: Context, providerId: String) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit().putBoolean(EPISODES_READY_PREFIX + providerId, true).apply()
    }

    fun clear(context: Context, providerId: String) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit()
            .remove(READY_PREFIX + providerId)
            .remove(METADATA_READY_PREFIX + providerId)
            .remove(EPISODES_READY_PREFIX + providerId)
            .remove(UPDATED_PREFIX + providerId)
            .apply()
    }
}
