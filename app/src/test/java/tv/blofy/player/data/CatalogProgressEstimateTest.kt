package tv.blofy.player.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class CatalogProgressEstimateTest {
    @Test fun sectionsAdvanceWithoutAnyServerContentLength() {
        val live = CatalogProgressEstimate.from(PlaylistSyncProgress(PlaylistSyncStage.LIVE, 1, 3))
        val movie = CatalogProgressEstimate.from(PlaylistSyncProgress(PlaylistSyncStage.MOVIES, 2, 3, completedSectionCount = 1))
        val series = CatalogProgressEstimate.from(PlaylistSyncProgress(PlaylistSyncStage.SERIES, 3, 3, completedSectionCount = 2))
        assertTrue(live < movie)
        assertTrue(movie < series)
        assertTrue(series < 100)
    }

    @Test fun failedAllSectionsNeverClaimsSixtyFivePercent() {
        val failedLive = CatalogProgressEstimate.from(PlaylistSyncProgress(PlaylistSyncStage.LIVE, 1, 3))
        val failedMovies = CatalogProgressEstimate.from(PlaylistSyncProgress(PlaylistSyncStage.MOVIES, 2, 3))
        val failedSeries = CatalogProgressEstimate.from(PlaylistSyncProgress(PlaylistSyncStage.SERIES, 3, 3))
        assertEquals(5, failedLive)
        assertEquals(5, failedMovies)
        assertEquals(5, failedSeries)
    }

    @Test fun declaredSectionBytesGiveSmoothIntermediateProgress() {
        val first = CatalogProgressEstimate.from(PlaylistSyncProgress(
            PlaylistSyncStage.LIVE, 1, 3, sectionTransferPercent = 50
        ))
        assertEquals(20, first)
        val endOfSeries = CatalogProgressEstimate.from(PlaylistSyncProgress(
            PlaylistSyncStage.SERIES, 3, 3, sectionTransferPercent = 100, completedSectionCount = 2
        ))
        assertEquals(95, endOfSeries)
    }

    @Test fun parserEstimateMovesWhenServerDoesNotDeclareLength() {
        val p1 = CatalogProgressEstimate.from(PlaylistSyncProgress(
            PlaylistSyncStage.SERIES, 3, 3, percentOverride = 90, completedSectionCount = 2
        ))
        val p2 = CatalogProgressEstimate.from(PlaylistSyncProgress(
            PlaylistSyncStage.SERIES, 3, 3, percentOverride = 94, completedSectionCount = 2
        ))
        assertTrue(p1 < p2)
        assertTrue(p2 < 100)
    }

    @Test fun malformedSectionPercentCannotShowOneHundredBeforeCommit() {
        val result = CatalogProgressEstimate.from(PlaylistSyncProgress(
            PlaylistSyncStage.SERIES, 3, 3, sectionTransferPercent = 500, completedSectionCount = 2
        ))
        assertEquals(95, result)
    }
}
