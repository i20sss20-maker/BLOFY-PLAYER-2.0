package tv.blofy.player.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class CatalogRefreshProgressTest {
    @Test fun measurableStagePercentOnlyChangesAfterParserReportsIt() {
        assertEquals(0, CatalogRefreshProgress.forSection(PlaylistSyncProgress(PlaylistSyncStage.LIVE, 1, 3)))
        assertEquals(33, CatalogRefreshProgress.forSection(PlaylistSyncProgress(PlaylistSyncStage.MOVIES, 2, 3)))
        assertEquals(66, CatalogRefreshProgress.forSection(PlaylistSyncProgress(PlaylistSyncStage.SERIES, 3, 3)))
        assertEquals(0, CatalogRefreshProgress.forSection(PlaylistSyncProgress(PlaylistSyncStage.LIVE, 1, 3, 18)))
        assertEquals(33, CatalogRefreshProgress.forSection(PlaylistSyncProgress(PlaylistSyncStage.LIVE, 1, 3, 30)))
        assertEquals(66, CatalogRefreshProgress.forSection(PlaylistSyncProgress(PlaylistSyncStage.MOVIES, 2, 3, 88)))
        assertEquals(95, CatalogRefreshProgress.forSection(PlaylistSyncProgress(PlaylistSyncStage.SERIES, 3, 3, 95)))
    }

    @Test fun completedSectionsProvideResumeBaselineWithoutPretendCommit() {
        assertEquals(0, CatalogRefreshProgress.completedBaseline(emptySet()))
        assertEquals(33, CatalogRefreshProgress.completedBaseline(setOf("live")))
        assertEquals(66, CatalogRefreshProgress.completedBaseline(setOf("live", "movie")))
        assertEquals(95, CatalogRefreshProgress.completedBaseline(setOf("live", "movie", "series")))
        assertTrue(CatalogRefreshProgress.afterSection("series") < 100)
    }
}
