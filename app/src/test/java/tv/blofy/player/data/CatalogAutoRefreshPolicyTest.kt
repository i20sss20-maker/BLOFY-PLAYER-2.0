package tv.blofy.player.data

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class CatalogAutoRefreshPolicyTest {
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
