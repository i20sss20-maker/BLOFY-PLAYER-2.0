package tv.blofy.player.data

/**
 * Honest, bounded progress for a full three-section Xtream refresh.
 *
 * Each section owns a fixed range. Within it, only stream parsing callbacks
 * advance the estimate; no animation timer or fabricated item count is used.
 * It is approximate if the server does not send Content-Length.
 * Reached 95% means all remote sections were saved, NOT that the DB promotion
 * finished. 100% is reported only after the atomic commit.
 */
internal object CatalogRefreshProgress {
    const val COMMIT_START = 95

    fun forSection(progress: PlaylistSyncProgress): Int {
        val (begin, end, sourceBegin, sourceEnd) = when (progress.stage) {
            PlaylistSyncStage.LIVE -> listOf(0, 33, 18, 30)
            PlaylistSyncStage.MOVIES -> listOf(33, 66, 60, 88)
            PlaylistSyncStage.SERIES -> listOf(66, COMMIT_START, 88, 95)
            PlaylistSyncStage.M3U -> listOf(0, COMMIT_START, 0, 100)
        }
        val observed = progress.percentOverride ?: return begin
        val fraction = (observed - sourceBegin).coerceIn(0, sourceEnd - sourceBegin).toDouble() /
            (sourceEnd - sourceBegin).coerceAtLeast(1)
        return (begin + (end - begin) * fraction).toInt().coerceIn(begin, end)
    }

    fun afterSection(kind: String): Int = when (kind) {
        "live" -> 33
        "movie" -> 66
        "series" -> COMMIT_START
        else -> 0
    }

    fun completedBaseline(sections: Set<String>): Int =
        sections.maxOfOrNull(::afterSection) ?: 0
}
