package tv.blofy.player.ui.search

internal object SearchResultBatchPolicy {
    const val BATCH_SIZE = 18

    fun nextEnd(alreadyDisplayed: Int, total: Int): Int {
        val safeTotal = total.coerceAtLeast(0)
        val start = alreadyDisplayed.coerceIn(0, safeTotal)
        return (start.toLong() + BATCH_SIZE).coerceAtMost(safeTotal.toLong()).toInt()
    }
}
