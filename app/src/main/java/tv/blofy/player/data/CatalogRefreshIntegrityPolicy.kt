package tv.blofy.player.data

/**
 * Protects the last-known-good local catalog from transient/truncated provider responses.
 *
 * A staged refresh is disposable until it passes this check. We deliberately prefer stale-but-
 * complete local data over destructively replacing a working library with a suspiciously small
 * response. Normal catalog changes remain accepted, while large providers get a stricter guard
 * because a truncated response can still contain tens of thousands of apparently valid rows.
 */
internal object CatalogRefreshIntegrityPolicy {
    data class Counts(
        val live: Int,
        val movies: Int,
        val series: Int,
    ) {
        val total: Int get() = live + movies + series
        fun forKind(kind: String): Int = when (kind) {
            "live" -> live
            "movie" -> movies
            "series" -> series
            else -> 0
        }
    }

    private const val MEDIUM_BASELINE = 100
    private const val HUGE_BASELINE = 1_000
    private const val MEDIUM_MIN_RETAINED_PERCENT = 50
    private const val HUGE_MIN_RETAINED_PERCENT = 85

    fun accepts(previous: Counts, candidate: Counts): Boolean {
        if (candidate.total <= 0) return false
        for (kind in listOf("live", "movie", "series")) {
            val oldCount = previous.forKind(kind)
            val newCount = candidate.forKind(kind)
            if (oldCount <= 0) continue

            // A previously populated section must never disappear because one endpoint returned [].
            if (newCount <= 0) return false

            // Very large IPTV libraries are where partial gateway responses are most common. A
            // 100k-row library truncated to 50k is still a large, valid-looking JSON response, so
            // protect it much more aggressively than a small catalog. The old catalog remains live
            // and the staged refresh is retried instead of accepting mass accidental deletion.
            val minimumPercent = when {
                oldCount >= HUGE_BASELINE -> HUGE_MIN_RETAINED_PERCENT
                oldCount >= MEDIUM_BASELINE -> MEDIUM_MIN_RETAINED_PERCENT
                else -> null
            }
            if (minimumPercent != null && newCount.toLong() * 100L < oldCount.toLong() * minimumPercent) {
                return false
            }
        }
        return true
    }
}
