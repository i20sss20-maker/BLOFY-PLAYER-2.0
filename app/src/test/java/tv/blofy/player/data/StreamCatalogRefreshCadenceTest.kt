package tv.blofy.player.data

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class StreamCatalogRefreshCadenceTest {
    @Test fun firstEntryAlwaysSchedulesRevisionCheck() {
        assertTrue(StreamCatalogRefreshCadence.isEntryCheckDue(0L, 100_000L))
    }

    @Test fun aSecondEntryWithinTwentyMinutesDoesNotFloodTheServer() {
        val previous = 100_000L
        assertFalse(StreamCatalogRefreshCadence.isEntryCheckDue(
            previous, previous + StreamCatalogRefreshCadence.ENTRY_MINIMUM_GAP_MS - 1L))
        assertTrue(StreamCatalogRefreshCadence.isEntryCheckDue(
            previous, previous + StreamCatalogRefreshCadence.ENTRY_MINIMUM_GAP_MS))
    }

    @Test fun clockRollbackDoesNotBlockRefreshForever() {
        assertTrue(StreamCatalogRefreshCadence.isEntryCheckDue(
            2_000_000L, 1_000_000L))
    }

    @Test fun periodicCheckNeverRequiresCustomerInteraction() {
        assertTrue(StreamCatalogRefreshCadence.PERIODIC_MINUTES >= 15L)
        assertTrue(StreamCatalogRefreshCadence.PERIODIC_MINUTES <= 60L)
    }
}
