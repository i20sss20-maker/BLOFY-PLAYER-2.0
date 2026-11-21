package tv.blofy.player.data

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class StreamCatalogRetryPolicyTest {
    @Test fun firstFailureCanRetryOnce() {
        assertFalse(StreamCatalogRetryPolicy.shouldDefer(0))
    }

    @Test fun repeatedAutomaticFailuresStopCurrentCycle() {
        assertTrue(StreamCatalogRetryPolicy.shouldDefer(1))
        assertTrue(StreamCatalogRetryPolicy.shouldDefer(10))
    }
}
