package tv.blofy.player.data

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class CatalogManualRefreshRetryPolicyTest {
    @Test fun manualRefreshNeverChainsMultipleSevenMinuteAttempts() {
        assertFalse(CatalogManualRefreshRetryPolicy.shouldRetry(manual = true, runAttemptCount = 0))
        assertFalse(CatalogManualRefreshRetryPolicy.shouldRetry(manual = true, runAttemptCount = 1))
        assertFalse(CatalogManualRefreshRetryPolicy.shouldRetry(manual = true, runAttemptCount = 10))
    }

    @Test fun silentAutomaticRefreshKeepsNormalWorkManagerRetries() {
        assertTrue(CatalogManualRefreshRetryPolicy.shouldRetry(manual = false, runAttemptCount = 0))
        assertTrue(CatalogManualRefreshRetryPolicy.shouldRetry(manual = false, runAttemptCount = 25))
    }
}
