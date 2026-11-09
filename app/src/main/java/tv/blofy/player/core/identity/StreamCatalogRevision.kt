package tv.blofy.player.core.identity

import android.content.Context
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import tv.blofy.player.BuildConfig
import tv.blofy.player.data.remote.XtreamClient

/**
 * BLOFY STREAM code-only opt-in catalog freshness check.
 *
 * Does NOT clear cache, change a device identity, or start background
 * playlist downloads. Existing Settings > تحديث المحتوى owns the safe
 * staged transaction that replaces catalog data only after 3 successful
 * sections. A failed revision query is always inconclusive.
 */
object StreamCatalogRevision {
    private const val PREFS = "blofy_stream_catalog_revision"
    private const val KEY = "last_committed_catalog_revision"

    /** Gson normally materializes numeric Map values as Double. */
    fun parseRevision(map: Map<String, Any?>): Long? {
        if (map["ok"] != true) return null
        val raw = map["revision"] ?: return null
        val value = when (raw) {
            is Number -> raw.toDouble().takeIf { it.isFinite() && it % 1.0 == 0.0 }
                ?.toLong()
            is String -> raw.takeIf { it.matches(Regex("(0|[1-9][0-9]{0,14})")) }
                ?.toLongOrNull()
            else -> null
        }
        return value?.takeIf { it in 0..9_007_199_254_740_991L }
    }

    fun updateAvailable(remote: Long?, saved: Long?, hasLocalCatalog: Boolean): Boolean =
        hasLocalCatalog && remote != null && remote > 0L &&
            (saved == null || remote > saved)

    fun saved(context: Context): Long? {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        if (!prefs.contains(KEY)) return null
        return prefs.getLong(KEY, 0L).takeIf { it >= 0L }
    }

    fun markSuccessfulSync(context: Context, versionObservedBeforeSync: Long?) {
        if (versionObservedBeforeSync == null || versionObservedBeforeSync < 0L) return
        // Only persist the version observed BEFORE the content download:
        // if the server changes during the download, the next onResume
        // still offers the newer catalog instead of marking stale as fresh.
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit().putLong(KEY, versionObservedBeforeSync).apply()
    }

    suspend fun fetchCurrent(context: Context): Long? {
        if (!BuildConfig.CODE_ONLY_LOGIN ||
            !StreamCodeSession.isClaimed(context)) return null
        return withTimeoutOrNull(4_000L) {
            withContext(Dispatchers.IO) {
                runCatching {
                    val url = StreamCodeSession.HOST +
                        "/player_api.php?action=get_blofy_catalog_version"
                    parseRevision(XtreamClient.api.objectResponse(url))
                }.getOrNull()
            }
        }
    }
}
