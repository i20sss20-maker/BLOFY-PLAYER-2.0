package tv.blofy.player.ui.player

import android.content.Context
import android.os.SystemClock
import java.util.concurrent.ConcurrentHashMap

/**
 * Personal-only voice shortcuts. No source URL, bearer, account code or device
 * identifier is stored. Observed failures are temporary and must NEVER be
 * presented as an authoritative source-health check.
 */
internal object StreamAudioQuickPickPrefs {
    private const val FILE = "blofy_stream_audio_quick_pick_v1"
    private const val FAVS = "favorite_track_ids"
    // Failures last only for this process; no wrong-TV-date dependency.
    private val failedAtElapsedMs = ConcurrentHashMap<String, Long>()
    private val validId = Regex("anis-[a-z0-9-]{1,54}")
    private const val MAX_FAVORITES = 12
    private const val FAIL_TTL_MS = 120_000L

    fun favorites(context: Context): Set<String> =
        context.getSharedPreferences(FILE, Context.MODE_PRIVATE)
            .getStringSet(FAVS, emptySet()).orEmpty()
            .filterTo(linkedSetOf()) { validId.matches(it) }
            .take(MAX_FAVORITES).toSet()

    /** Returns whether the track is now a favorite. */
    fun toggleFavorite(context: Context, id: String): Boolean {
        if (!validId.matches(id)) return false
        val current = favorites(context).toMutableSet()
        val added = if (id in current) {
            current.remove(id)
            false
        } else {
            if (current.size >= MAX_FAVORITES) return false
            current.add(id)
            true
        }
        context.getSharedPreferences(FILE, Context.MODE_PRIVATE).edit()
            .putStringSet(FAVS, current.toSet()).apply()
        return added
    }

    fun markFailed(context: Context, id: String) {
        if (!validId.matches(id)) return
        failedAtElapsedMs[id] = SystemClock.elapsedRealtime()
    }

    fun markStarted(context: Context, id: String) {
        if (!validId.matches(id)) return
        failedAtElapsedMs.remove(id)
    }

    fun failedRecently(context: Context, id: String): Boolean {
        if (!validId.matches(id)) return false
        val at = failedAtElapsedMs[id] ?: return false
        val age = SystemClock.elapsedRealtime() - at
        return age >= 0 && age < FAIL_TTL_MS
    }
}

/** UI order is purely local experience, NOT a claim that audio is online. */
internal object StreamAudioQuickPickPolicy {
    data class Label(val value: String, val state: State)
    enum class State { PLAYING, RECENTLY_WORKED, FAILED_RECENTLY, UNTESTED }

    fun status(
        id: String, playingId: String?, lastWorkingId: String?, recentlyFailed: Set<String>
    ): State = when {
        id == playingId -> State.PLAYING
        id in recentlyFailed -> State.FAILED_RECENTLY
        id == lastWorkingId -> State.RECENTLY_WORKED
        else -> State.UNTESTED
    }

    fun <T> arrange(
        items: List<T>, favorites: Set<String>, lastWorkingId: String?,
        recentlyFailed: Set<String>, key: (T) -> String
    ): List<T> = items.distinctBy(key).sortedWith(
        compareBy<T> {
            val id = key(it)
            when {
                id in favorites -> 0
                id == lastWorkingId -> 1
                else -> 2
            }
        }.thenBy { if (key(it) in recentlyFailed) 1 else 0 }
        // stable ordering preserves the original server catalogue group order
    )
}
