package tv.blofy.player.data

import android.content.Context
import tv.blofy.player.BuildConfig

/**
 * One quiet WorkManager request at app entry, not one huge Xtream fetch on every
 * Home focus/resume. Keeps the existing daily periodic job as a fallback.
 */
internal object CatalogEntryRefreshThrottle {
    private const val PREFS = "blofy_catalog_silent_entry_refresh_v1"
    private const val REQUEST_PREFIX = "last_entry_request:"

    fun claimIfDue(context: Context, providerId: String,
                   lastCompletedAtMs: Long, nowMs: Long = System.currentTimeMillis()): Boolean {
        if (providerId.isBlank()) return false
        synchronized(this) {
            val prefs = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            val key = REQUEST_PREFIX + providerId
            val previous = prefs.getLong(key, 0L)
            if (!CatalogAutoRefreshPolicy.mayQueueEntry(
                    lastCompletedAtMs, previous, nowMs, BuildConfig.CODE_ONLY_LOGIN
                )) return false
            // Persist before enqueue so multiple quick Activity resumes don't race.
            return prefs.edit().putLong(key, nowMs).commit()
        }
    }
}
