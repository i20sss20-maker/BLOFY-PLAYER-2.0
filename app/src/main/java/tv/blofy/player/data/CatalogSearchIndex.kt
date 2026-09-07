package tv.blofy.player.data

import android.content.Context
import tv.blofy.player.data.local.BlofyDao

/** Readiness belongs to the FTS schema generation, independently of the saved catalog. */
object CatalogSearchIndex {
    private const val PREFS = "blofy_search_index"
    // Database migration 9 -> 10 recreates FTS, so an old v9 readiness flag is not sufficient.
    private const val READY_PREFIX = "v10_ready_"

    fun isReady(context: Context, providerId: String): Boolean =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean(READY_PREFIX + providerId, false)

    suspend fun ensureReady(context: Context, dao: BlofyDao, providerId: String) {
        if (isReady(context, providerId)) return
        // Normal streaming imports already persisted FTS in batches. Only an empty index after a
        // migration needs a rebuild; do not duplicate a full 200k-row pass on every first import.
        if (!dao.hasSearchIndex(providerId)) dao.rebuildSearchIndex(providerId)
        check(dao.hasSearchIndex(providerId)) { "Search index has no saved catalog rows" }
        check(context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putBoolean(READY_PREFIX + providerId, true).commit()) { "Unable to persist search readiness" }
    }
}
