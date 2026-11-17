package tv.blofy.player.ui.series

import org.junit.Assert.*
import org.junit.Test

class RecentEpisodesRefreshWorkerTest {
    @Test fun catchupIsLimitedToFiveSeriesRatherThanScanningTheWholeXtreamCatalog() {
        assertEquals(5, RecentEpisodesRefreshWorker.MAX_SERIES_PER_RUN)
    }

    @Test fun entryIsQuietAndBoundedWhenTheTvIsReopened() {
        val now = 100_000_000L
        val interval = RecentEpisodesRefreshWorker.ENTRY_GAP_MS
        assertTrue(RecentEpisodesRefreshWorker.due(0L, now))
        assertFalse(RecentEpisodesRefreshWorker.due(now, now))
        assertFalse(RecentEpisodesRefreshWorker.due(now - interval + 1L, now))
        assertTrue(RecentEpisodesRefreshWorker.due(now - interval, now))
        assertFalse(RecentEpisodesRefreshWorker.due(now, now - 1L))
    }
}
