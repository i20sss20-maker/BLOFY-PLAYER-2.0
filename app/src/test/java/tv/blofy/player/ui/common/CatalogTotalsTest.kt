package tv.blofy.player.ui.common

import org.junit.Assert.assertEquals
import org.junit.Test

class CatalogTotalsTest {
    @Test fun exactCountsAreSelectedPerCatalogKind() {
        val totals = CatalogTotals(live = 18342, movies = 7450, series = 1271)
        assertEquals(18342, totals.forKind("live"))
        assertEquals(7450, totals.forKind("movie"))
        assertEquals(1271, totals.forKind("series"))
        assertEquals(0, totals.forKind("unknown"))
    }

    @Test fun countsAreExactAndFormattedWithoutPageSizeApproximation() {
        assertEquals("18,342", CatalogTotals.formatted(18342))
        assertEquals("7,450", CatalogTotals.formatted(7450))
        assertEquals("1,271", CatalogTotals.formatted(1271))
        assertEquals("0", CatalogTotals.formatted(-10))
    }
}
