package tv.blofy.player.ui.common

import java.text.NumberFormat
import java.util.Locale

/**
 * Exact local catalog totals for the currently active provider.
 * Never use the loaded page length as the library total: catalogs are paginated.
 */
data class CatalogTotals(val live: Int, val movies: Int, val series: Int) {
    fun forKind(kind: String): Int = when (kind) {
        "live" -> live
        "movie" -> movies
        "series" -> series
        else -> 0
    }

    companion object {
        val EMPTY = CatalogTotals(0, 0, 0)
        fun formatted(value: Int): String =
            NumberFormat.getIntegerInstance(Locale.US).format(value.coerceAtLeast(0))
    }
}
