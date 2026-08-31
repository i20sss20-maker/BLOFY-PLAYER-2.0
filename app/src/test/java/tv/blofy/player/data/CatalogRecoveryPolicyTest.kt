package tv.blofy.player.data

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class CatalogRecoveryPolicyTest {
    @Test
    fun repairsMissingMovieOrSeriesCatalogOnce() {
        assertTrue(CatalogRecoveryPolicy.shouldAutoRefresh("movie", 0, attempted = false, refreshInProgress = false))
        assertTrue(CatalogRecoveryPolicy.shouldAutoRefresh("series", 0, attempted = false, refreshInProgress = false))
        assertFalse(CatalogRecoveryPolicy.shouldAutoRefresh("movie", 1, attempted = false, refreshInProgress = false))
        assertFalse(CatalogRecoveryPolicy.shouldAutoRefresh("movie", 0, attempted = true, refreshInProgress = false))
        assertFalse(CatalogRecoveryPolicy.shouldAutoRefresh("movie", 0, attempted = false, refreshInProgress = true))
    }

    @Test
    fun neverChangesLiveCatalogBehavior() {
        assertFalse(CatalogRecoveryPolicy.shouldAutoRefresh("live", 0, attempted = false, refreshInProgress = false))
    }
}
