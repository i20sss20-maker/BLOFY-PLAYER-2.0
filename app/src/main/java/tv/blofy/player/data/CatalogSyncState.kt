package tv.blofy.player.data

import android.content.Context

/** Stores catalog readiness and the last successful refresh time per provider. */
object CatalogSyncState {
    private const val PREFS = "blofy_catalog_sync_state"
    private const val READY_PREFIX = "ready:"
    private const val UPDATED_PREFIX = "updated:"

    fun isReady(context: Context, providerId: String): Boolean =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .getBoolean(READY_PREFIX + providerId, false)

    fun lastUpdatedAt(context: Context, providerId: String): Long =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .getLong(UPDATED_PREFIX + providerId, 0L)

    // Compatibility alias used by SettingsActivity. Keep both names to avoid coupling UI code
    // to the storage implementation name.
    fun lastSyncedAt(context: Context, providerId: String): Long = lastUpdatedAt(context, providerId)

    fun markPending(context: Context, providerId: String) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit().putBoolean(READY_PREFIX + providerId, false).apply()
    }

    fun markReady(context: Context, providerId: String) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit()
            .putBoolean(READY_PREFIX + providerId, true)
            .putLong(UPDATED_PREFIX + providerId, System.currentTimeMillis())
            .apply()
        // Restart from the first series after every successful catalog commit. Existing cached
        // episodes are skipped by the worker, while any previously missed/failed series are
        // revisited instead of being stranded behind an old WorkManager chain/backoff.
        EpisodeCatalogPreloader.schedule(context.applicationContext, providerId, replace = true)
    }

    fun clear(context: Context, providerId: String) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit()
            .remove(READY_PREFIX + providerId)
            .remove(UPDATED_PREFIX + providerId)
            .apply()
    }
}
