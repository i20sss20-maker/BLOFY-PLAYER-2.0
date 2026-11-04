package tv.blofy.player.data

import org.junit.Assert.*
import org.junit.Test

class CatalogProgressThrottleTest {
    @Test fun highVolumeRowsCannotFloodUi() {
        var now = 100L
        val throttle = CatalogProgressThrottle(intervalMs = 500L, clockMs = { now })
        val live = PlaylistSyncProgress(PlaylistSyncStage.LIVE, 1, 3)
        assertTrue(throttle.shouldRender(live))
        repeat(5000) {
            assertFalse(throttle.shouldRender(live.copy(parsedItems = it)))
        }
        now += 500L
        assertTrue(throttle.shouldRender(live.copy(parsedItems = 5000)))
        assertFalse(throttle.shouldRender(live.copy(parsedItems = 6000)))
    }

    @Test fun sectionChangesAndRetriesAreImmediate() {
        val throttle = CatalogProgressThrottle(intervalMs = 500L, clockMs = { 5L })
        assertTrue(throttle.shouldRender(PlaylistSyncProgress(PlaylistSyncStage.LIVE, 1, 3)))
        assertTrue(throttle.shouldRender(PlaylistSyncProgress(PlaylistSyncStage.MOVIES, 2, 3)))
        assertTrue(throttle.shouldRender(PlaylistSyncProgress(PlaylistSyncStage.MOVIES, 2, 3, retryAttempt = 2)))
        assertFalse(throttle.shouldRender(PlaylistSyncProgress(PlaylistSyncStage.MOVIES, 2, 3, retryAttempt = 2)))
    }
    @Test fun verifiedSectionCompletionIsDisplayedImmediately() {
        val throttle = CatalogProgressThrottle(intervalMs = 500L, clockMs = { 100L })
        val first = PlaylistSyncProgress(PlaylistSyncStage.LIVE, 1, 3)
        assertTrue(throttle.shouldRender(first))
        assertFalse(throttle.shouldRender(first.copy(parsedItems = 20000)))
        assertTrue(throttle.shouldRender(first.copy(completedSectionCount = 1)))
    }

}
