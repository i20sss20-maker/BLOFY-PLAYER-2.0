package tv.blofy.player.data

/**
 * BLOFY's default Xtream catalog order is EXACTLY the order returned by the
 * corresponding get_live_categories/get_vod_categories/get_series_categories
 * and get_live_streams/get_vod_streams/get_series response arrays.
 *
 * A previous version *re-sorted* those arrays using category_order, sort_order
 * and channel num. These fields vary across panels and often disagree with
 * the actual playlist order seen in other players. Do not infer an order here:
 * no alphabetical, ID, date, group, num, or metadata-based client sorting.
 */
internal object XtreamServerOrder {
    /** Identity function by design: do not reorder or drop server rows. */
    fun categories(rows: List<Map<String, Any?>>): List<Map<String, Any?>> = rows

    /** This position is the 1-based index inside the original response array. */
    @Suppress("UNUSED_PARAMETER")
    fun streamPosition(row: Map<String, Any?>, oneBasedArrayPosition: Long): Long =
        oneBasedArrayPosition
}
