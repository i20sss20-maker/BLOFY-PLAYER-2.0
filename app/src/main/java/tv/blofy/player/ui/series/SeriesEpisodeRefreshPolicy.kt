package tv.blofy.player.ui.series

import android.content.Context

/**
 * A cached season is immediately viewable, but its Xtream get_series_info may
 * gain episodes even when the parent series card has not changed.
 * Refresh in the background after the user enters the episode page and while the
 * page remains visible; cap checks to one source request per series per 3 minutes.
 */
internal object SeriesEpisodeRefreshPolicy {
    const val SUCCESS_GAP_MS = 3L * 60_000L
    const val FAILURE_RETRY_GAP_MS = 3L * 60_000L
    private const val PREFS = "blofy_stream_series_episode_auto_refresh_v1"

    fun shouldAttempt(lastSuccessMs: Long, lastAttemptMs: Long, nowMs: Long): Boolean =
        elapsed(lastSuccessMs, nowMs, SUCCESS_GAP_MS) &&
            elapsed(lastAttemptMs, nowMs, FAILURE_RETRY_GAP_MS)

    private fun elapsed(pastMs: Long, nowMs: Long, minimumMs: Long): Boolean =
        pastMs <= 0L || (nowMs >= pastMs && nowMs - pastMs >= minimumMs)

    fun claim(context: Context, providerId: String, seriesId: String,
              nowMs: Long = System.currentTimeMillis()): Boolean {
        if (providerId.isBlank() || seriesId.isBlank()) return false
        synchronized(this) {
            val prefs = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            val id = "$providerId:$seriesId"
            if (!shouldAttempt(
                    prefs.getLong("$id:success", 0L),
                    prefs.getLong("$id:attempt", 0L), nowMs
                )) return false
            return prefs.edit().putLong("$id:attempt", nowMs).commit()
        }
    }

    fun markSuccess(context: Context, providerId: String, seriesId: String,
                    nowMs: Long = System.currentTimeMillis()) {
        if (providerId.isBlank() || seriesId.isBlank()) return
        context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit().putLong("$providerId:$seriesId:success", nowMs).apply()
    }
}
