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
        val now = 10_000_000L
        assertFalse(CatalogAutoRefreshPolicy.isDue(
            now - CatalogAutoRefreshPolicy.MINIMUM_GAP_MS + 1L, now
        ))
    }

    @Test fun refreshDueAtThirtyMinuteBoundary() {
        val now = 10_000_000L
        assertTrue(CatalogAutoRefreshPolicy.isDue(
            now - CatalogAutoRefreshPolicy.MINIMUM_GAP_MS, now
        ))
    }

    @Test fun streamIsDailyAndDoesNotDownloadAgainAfterThirtyMinutes() {
        val now = 1_000_000_000L
        val daily = CatalogAutoRefreshPolicy.STREAM_MINIMUM_GAP_MS
        assertTrue(CatalogAutoRefreshPolicy.STREAM_INTERVAL_MINUTES >= 24L * 60L)
        assertFalse(CatalogAutoRefreshPolicy.isDue(now - 30L * 60_000L, now, daily))
        assertFalse(CatalogAutoRefreshPolicy.isDue(now - daily + 1L, now, daily))
        assertTrue(CatalogAutoRefreshPolicy.isDue(now - daily, now, daily))
        assertTrue(CatalogAutoRefreshPolicy.isDue(0L, now, daily))
        assertFalse(CatalogAutoRefreshPolicy.isDue(now + 3600L, now, daily))
        assertTrue(CatalogAutoRefreshPolicy.isDue(now + 3600L, now, daily,
            clockRollbackIsDue = true))
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
}
