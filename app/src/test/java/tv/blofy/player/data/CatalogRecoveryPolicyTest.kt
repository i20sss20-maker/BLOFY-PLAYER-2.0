package tv.blofy.player.data

import org.junit.Assert.assertFalse
import org.junit.Test

class CatalogRecoveryPolicyTest {
    @Test
    fun navigationNeverAutoRefreshesCachedCatalogs() {
        assertFalse(CatalogRecoveryPolicy.shouldAutoRefresh("movie", 0, attempted = false, refreshInProgress = false))
        assertFalse(CatalogRecoveryPolicy.shouldAutoRefresh("series", 0, attempted = false, refreshInProgress = false))
        assertFalse(CatalogRecoveryPolicy.shouldAutoRefresh("movie", 1, attempted = false, refreshInProgress = false))
        assertFalse(CatalogRecoveryPolicy.shouldAutoRefresh("movie", 0, attempted = true, refreshInProgress = false))
        assertFalse(CatalogRecoveryPolicy.shouldAutoRefresh("movie", 0, attempted = false, refreshInProgress = true))
        assertFalse(CatalogRecoveryPolicy.shouldAutoRefresh("live", 0, attempted = false, refreshInProgress = false))
    }
}
