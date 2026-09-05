package tv.blofy.player.data.preparation

/** Weighted stages. The caller counts durable completed units, not elapsed time. */
object PreparationProgress {
    enum class Stage(val start: Int, val end: Int) {
        CATALOG(0, 30), DETAILS(30, 60), ARTWORK(60, 95), FINALIZE(95, 99)
    }

    fun percent(stage: Stage, completed: Long, total: Long): Int {
        require(completed >= 0L && total >= 0L && completed <= total)
        if (total == 0L || completed == total) return stage.end
        // Floating-point rounding must not report an entire stage complete early.
        return (stage.start + ((completed.toDouble() / total) * (stage.end - stage.start)).toInt())
            .coerceIn(stage.start, stage.end - 1)
    }

    fun canComplete(detailPending: Long, artworkPending: Long, finalized: Boolean): Boolean {
        require(detailPending >= 0L && artworkPending >= 0L)
        return detailPending == 0L && artworkPending == 0L && finalized
    }
}
