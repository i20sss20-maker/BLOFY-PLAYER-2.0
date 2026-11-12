package tv.blofy.player.ui.catalog

import org.junit.Assert.*
import org.junit.Test

class CatalogSortPolicyTest {
    @Test fun sourceRemainsDefaultAndCanCycleThroughSafeSorts() {
        assertEquals(CatalogSortPolicy.Mode.SOURCE, CatalogSortPolicy.Mode.entries.first())
        assertEquals(CatalogSortPolicy.Mode.NEWEST, CatalogSortPolicy.Mode.SOURCE.next())
        assertEquals(CatalogSortPolicy.Mode.RATING, CatalogSortPolicy.Mode.NEWEST.next())
        assertEquals(CatalogSortPolicy.Mode.YEAR, CatalogSortPolicy.Mode.RATING.next())
        assertEquals(CatalogSortPolicy.Mode.SOURCE, CatalogSortPolicy.Mode.YEAR.next())
    }

    @Test fun sortingNeverInterpolatesProviderValuesOrChangesPlaybackIdentity() {
        for (mode in CatalogSortPolicy.Mode.entries.filterNot { it == CatalogSortPolicy.Mode.SOURCE }) {
            val query = CatalogSortPolicy.query("evil' OR 1=1 --", "movie", "genre-4",
                mode, offset = 192, limit = 64)
            assertTrue(query.sql.startsWith("SELECT s.* FROM streams s"))
            assertTrue(query.sql.contains("s.categoryId = ?"))
            assertTrue(query.sql.contains("LIMIT ? OFFSET ?"))
            assertTrue(query.sql.contains("s.rowid ASC"))
            assertFalse(query.sql.contains("evil'"))
            assertFalse(query.sql.contains("genre-4"))
            assertFalse(query.sql.contains("UPDATE"))
        }
    }

    @Test fun queryBoundsLargePagingRequestsAndDoesNotPermitLiveSort() {
        val q = CatalogSortPolicy.query("p", "series", null,
            CatalogSortPolicy.Mode.RATING, offset = -1, limit = 2000)
        assertFalse(q.sql.contains("s.categoryId = ?"))
        assertTrue(q.sql.contains("AS REAL"))
        assertThrows(IllegalArgumentException::class.java) {
            CatalogSortPolicy.query("p", "live", null,
                CatalogSortPolicy.Mode.NEWEST, 0, 50)
        }
    }
}
