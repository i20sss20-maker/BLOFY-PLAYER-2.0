package tv.blofy.player.data

/**
 * Xtream panels may supply a separate explicit ordering in addition to their JSON array.
 * Use the panel's number when present; otherwise keep the exact response sequence.
 * No locale, title, date or category-ID sort is performed by BLOFY.
 */
internal object XtreamServerOrder {
    private const val ENTRY_TIE_BREAKER = 1_000_000_000L
    private const val UNNUMBERED_START = 8_000_000_000_000_000_000L
    private const val MAX_NUMBERED_ENTRY = 7_000_000_000L

    fun categories(rows: List<Map<String, Any?>>): List<Map<String, Any?>> =
        rows.withIndex().sortedWith(
            compareBy<IndexedValue<Map<String, Any?>>> {
                firstOrdinal(it.value, "category_order", "sort_order", "order", "position")
                    ?: Long.MAX_VALUE
            }.thenBy { it.index }
        ).map { it.value }

    /** Globally unique for a catalog of <= 999,999,999 items, even if a panel duplicates 'num'. */
    fun streamPosition(row: Map<String, Any?>, oneBasedArrayPosition: Long): Long {
        val tie = oneBasedArrayPosition.coerceIn(1L, ENTRY_TIE_BREAKER - 1L)
        val number = firstOrdinal(row, "num", "stream_order", "sort_order")
            ?.takeIf { it < MAX_NUMBERED_ENTRY }
        return if (number == null) UNNUMBERED_START + tie
        else number * ENTRY_TIE_BREAKER + tie
    }

    private fun firstOrdinal(row: Map<String, Any?>, vararg names: String): Long? =
        names.firstNotNullOfOrNull { field ->
            when (val value = row[field]) {
                is Number -> value.toDouble().takeIf { it.isFinite() && it >= 0.0 &&
                    it < MAX_NUMBERED_ENTRY.toDouble() && it % 1.0 == 0.0 }?.toLong()
                is String -> value.trim().toLongOrNull()?.takeIf { it in 0 until MAX_NUMBERED_ENTRY }
                else -> null
            }
        }
}
