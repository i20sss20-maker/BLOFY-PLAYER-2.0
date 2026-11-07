package tv.blofy.player.data

import android.content.Context

/**
 * Records whether a provider has completed a full catalog synchronization successfully.
 * A valid provider may legitimately have an empty Live, Movies, or Series section, so cache
 * readiness must not be inferred from every section containing at least one item.
 */
object CatalogSyncState {
    private const val PREFS = "blofy_catalog_sync_state"
    private const val PREFIX = "ready:"
    private const val PENDING_PREFIX = "pending:"

    fun isReady(context: Context, providerId: String): Boolean =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .getBoolean(PREFIX + providerId, false)

    /** Preserve the last fully synchronized catalog while a staged refresh runs. */
    fun markPending(context: Context, providerId: String) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit().putBoolean(PENDING_PREFIX + providerId, true).apply()
    }

    fun markReady(context: Context, providerId: String) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit()
            .putBoolean(PREFIX + providerId, true)
            .putBoolean(PENDING_PREFIX + providerId, false)
            .apply()
    }

    fun markFailed(context: Context, providerId: String) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit().putBoolean(PENDING_PREFIX + providerId, false).apply()
    }
}
