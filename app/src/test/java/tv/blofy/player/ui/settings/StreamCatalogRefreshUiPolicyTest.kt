package tv.blofy.player.ui.settings

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class StreamCatalogRefreshUiPolicyTest {
    @Test fun autoRefreshNeverHoldsASettingsSpinner() {
        assertFalse(StreamCatalogRefreshUiPolicy.showSpinner(
            manualRequested = false, workInFlight = true, movedToBackground = false))
    }

    @Test fun manualRefreshShowsShortFeedbackOnly() {
        assertTrue(StreamCatalogRefreshUiPolicy.showSpinner(
            manualRequested = true, workInFlight = true, movedToBackground = false))
        assertFalse(StreamCatalogRefreshUiPolicy.showSpinner(
            manualRequested = true, workInFlight = true, movedToBackground = true))
        assertFalse(StreamCatalogRefreshUiPolicy.showSpinner(
            manualRequested = true, workInFlight = false, movedToBackground = false))
    }

    @Test fun foregroundSpinnerIsTimeLimited() {
        assertTrue(StreamCatalogRefreshUiPolicy.FOREGROUND_SPINNER_MS in 15_000L..45_000L)
    }
}
