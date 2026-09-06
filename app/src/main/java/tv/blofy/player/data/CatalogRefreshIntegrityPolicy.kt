package tv.blofy.player.data

/**
 * Protects the last-known-good local catalog from transient/truncated provider responses.
 *
 * A staged refresh is disposable until it passes this check. We deliberately prefer stale-but-
 * complete local data over destructively replacing a working library with a suspiciously small
 * response. Normal small catalog changes are accepted; catastrophic drops must be retried later.
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

    private const val LARGE_BASELINE = 100
    private const val MIN_RETAINED_PERCENT = 50

    fun accepts(previous: Counts, candidate: Counts): Boolean {
        if (candidate.total <= 0) return false
        for (kind in listOf("live", "movie", "series")) {
            val oldCount = previous.forKind(kind)
            val newCount = candidate.forKind(kind)
            if (oldCount <= 0) continue

            // A previously populated section must never disappear because one endpoint returned [].
            if (newCount <= 0) return false

            // Large libraries occasionally return a valid HTTP/JSON response that is truncated or
            // only partially populated. Do not interpret that transient response as mass deletion.
            if (oldCount >= LARGE_BASELINE && newCount.toLong() * 100L < oldCount.toLong() * MIN_RETAINED_PERCENT) {
                return false
            }
        }
        return true
    }
}
