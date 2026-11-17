package tv.blofy.player.data

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class CatalogAutoRefreshPolicyTest {
    @Test fun backgroundSyncDeadlineLeavesTimeForWorkerCleanup() {
        assertTrue(CatalogAutoRefreshPolicy.MAX_SINGLE_SYNC_MS < 10L * 60_000L)
        assertTrue(CatalogAutoRefreshPolicy.MAX_SINGLE_SYNC_MS >= 60_000L)
    }

    @Test fun firstRefreshIsDueWithoutTimestamp() {
        assertTrue(CatalogAutoRefreshPolicy.isDue(0L, 1_000_000L))
    }

    @Test fun refreshingTooSoonDoesNotReloadHugeCatalog() {
        assertTrue(CatalogAutoRefreshPolicy.INTERVAL_MINUTES == 24L * 60L)
        assertTrue(CatalogAutoRefreshPolicy.MINIMUM_GAP_MS == 24L * 60L * 60_000L)
        val now = 200_000_000L
        assertFalse(CatalogAutoRefreshPolicy.isDue(
            now - CatalogAutoRefreshPolicy.MINIMUM_GAP_MS + 1L, now
        ))
    }

    @Test fun refreshDueAtDailyBoundary() {
        val now = 200_000_000L
        assertTrue(CatalogAutoRefreshPolicy.isDue(
            now - CatalogAutoRefreshPolicy.MINIMUM_GAP_MS, now
        ))
    }

    @Test fun clockRollbackDoesNotCauseRepeatedDownloads() {
        assertFalse(CatalogAutoRefreshPolicy.isDue(10_000L, 9_000L))
    }

    @Test fun activeVideoIsProtectedFromCatalogWork() {
        assertFalse(CatalogPlaybackGate.isPlaying)
        CatalogPlaybackGate.playerStarted()
        try {
            assertTrue(CatalogPlaybackGate.isPlaying)
            CatalogPlaybackGate.playerStarted()
            CatalogPlaybackGate.playerStopped()
            assertTrue(CatalogPlaybackGate.isPlaying)
        } finally {
            CatalogPlaybackGate.playerStopped()
        }
        assertFalse(CatalogPlaybackGate.isPlaying)
    }

    @Test fun silentStreamEntryGetsNewSeriesAfterSixHoursWithoutChangingPlayerSchedule() {
        val now = 200_000_000L
        val sixHours = CatalogAutoRefreshPolicy.STREAM_ENTRY_MINIMUM_GAP_MS
        assertTrue(sixHours < CatalogAutoRefreshPolicy.MINIMUM_GAP_MS)
        assertFalse(CatalogAutoRefreshPolicy.isDueForProduct(now - sixHours + 1L, now, true))
        assertTrue(CatalogAutoRefreshPolicy.isDueForProduct(now - sixHours, now, true))
        assertFalse(CatalogAutoRefreshPolicy.isDueForProduct(now - sixHours, now, false))
        assertTrue(CatalogAutoRefreshPolicy.isDueForProduct(
            now - CatalogAutoRefreshPolicy.MINIMUM_GAP_MS, now, false))
    }

    @Test fun rapidReopeningDoesNotQueueRepeatedLargeXtreamDownloads() {
        val now = 100_000_000L
        val lastSuccess = now - CatalogAutoRefreshPolicy.STREAM_ENTRY_MINIMUM_GAP_MS
        assertTrue(CatalogAutoRefreshPolicy.mayQueueEntry(lastSuccess, 0L, now, true))
        assertFalse(CatalogAutoRefreshPolicy.mayQueueEntry(lastSuccess, now, now + 5_000L, true))
        assertFalse(CatalogAutoRefreshPolicy.mayQueueEntry(lastSuccess,
            now, now + CatalogAutoRefreshPolicy.ENTRY_RETRY_GUARD_MS - 1L, true))
        assertTrue(CatalogAutoRefreshPolicy.mayQueueEntry(lastSuccess,
            now, now + CatalogAutoRefreshPolicy.ENTRY_RETRY_GUARD_MS, true))
        assertFalse(CatalogAutoRefreshPolicy.mayQueueEntry(
            now - CatalogAutoRefreshPolicy.MINIMUM_GAP_MS * 2L, now,
            now - 1L, true))
    }
}
