package tv.blofy.player.data.preparation

import android.content.Context

internal enum class FullLibraryPhase(val kind: String?) {
    MOVIE_POSTERS("movie"),
    SERIES_POSTERS("series"),
    LIVE_LOGOS("live"),
    MOVIE_BACKDROPS("movie"),
    SERIES_BACKDROPS("series"),
    MOVIE_DETAILS("movie"),
    SERIES_DETAILS("series"),
    MOVIE_ENRICHED_ART("movie"),
    SERIES_ENRICHED_ART("series"),
    RETRY_DETAILS(null),
    RETRY_ART(null),
    COMPLETE(null)
}

internal data class FullLibraryCursor(
    val epoch: Long,
    val phase: FullLibraryPhase,
    val rowId: Long,
    val complete: Boolean
)

internal object FullLibrarySyncState {
    private const val PREFS = "blofy_full_library_sync_v1"
    // Rescan older cursors once: those could skip partially failed pages. Keep saved artwork.
    internal const val REVISION = 2

    private fun key(providerId: String, suffix: String) = "$providerId:$suffix"

    fun read(context: Context, providerId: String, epoch: Long, resetInvalid: Boolean = true): FullLibraryCursor {
        val prefs = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val savedEpoch = prefs.getLong(key(providerId, "epoch"), 0L)
        if (savedEpoch != epoch || epoch <= 0L || prefs.getInt(key(providerId, "revision"), 0) != REVISION) {
            if (resetInvalid) reset(context, providerId, epoch)
            return FullLibraryCursor(epoch, FullLibraryPhase.MOVIE_POSTERS, 0L, false)
        }
        val phase = FullLibraryPhase.entries.getOrNull(
            prefs.getInt(key(providerId, "phase"), 0)
        ) ?: FullLibraryPhase.MOVIE_POSTERS
        return FullLibraryCursor(
            epoch = epoch,
            phase = phase,
            rowId = prefs.getLong(key(providerId, "row"), 0L).coerceAtLeast(0L),
            complete = prefs.getBoolean(key(providerId, "complete"), false)
        )
    }

    fun checkpoint(context: Context, providerId: String, epoch: Long, phase: FullLibraryPhase, rowId: Long) {
        val prefs = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        check(
            prefs.edit()
                .putInt(key(providerId, "revision"), REVISION)
                .putLong(key(providerId, "epoch"), epoch)
                .putInt(key(providerId, "phase"), phase.ordinal)
                .putLong(key(providerId, "row"), rowId.coerceAtLeast(0L))
                .putBoolean(key(providerId, "complete"), false)
                .putLong(key(providerId, "updated"), System.currentTimeMillis())
                .commit()
        ) { "Unable to persist full-library checkpoint" }
    }

    fun advance(context: Context, providerId: String, epoch: Long, phase: FullLibraryPhase) {
        val next = FullLibraryPhase.entries.getOrNull(phase.ordinal + 1) ?: FullLibraryPhase.COMPLETE
        checkpoint(context, providerId, epoch, next, 0L)
    }

    fun complete(context: Context, providerId: String, epoch: Long) {
        val prefs = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        check(
            prefs.edit()
                .putInt(key(providerId, "revision"), REVISION)
                .putLong(key(providerId, "epoch"), epoch)
                .putInt(key(providerId, "phase"), FullLibraryPhase.COMPLETE.ordinal)
                .putLong(key(providerId, "row"), 0L)
                .putBoolean(key(providerId, "complete"), true)
                .putLong(key(providerId, "updated"), System.currentTimeMillis())
                .commit()
        ) { "Unable to persist full-library completion" }
    }

    fun reset(context: Context, providerId: String, epoch: Long) {
        val prefs = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        prefs.edit()
            .putInt(key(providerId, "revision"), REVISION)
            .putLong(key(providerId, "epoch"), epoch)
            .putInt(key(providerId, "phase"), FullLibraryPhase.MOVIE_POSTERS.ordinal)
            .putLong(key(providerId, "row"), 0L)
            .putBoolean(key(providerId, "complete"), false)
            .putLong(key(providerId, "updated"), System.currentTimeMillis())
            .commit().also { check(it) { "Unable to reset full-library checkpoint" } }
    }

    fun clear(context: Context, providerId: String) {
        val prefs = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val prefix = "$providerId:"
        val edit = prefs.edit()
        prefs.all.keys.filter { it.startsWith(prefix) }.forEach(edit::remove)
        edit.apply()
    }
}
