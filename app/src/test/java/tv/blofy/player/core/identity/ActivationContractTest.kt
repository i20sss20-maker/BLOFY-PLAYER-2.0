package tv.blofy.player.core.identity

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ActivationContractTest {
    @Test fun active_without_expiry_can_use() {
        assertTrue(ActivationCheckResponse("active").canUse(1000L))
    }

    @Test fun trial_before_expiry_can_use() {
        assertTrue(ActivationCheckResponse("trial", expiresAt = 2000L).canUse(1000L))
    }

    @Test fun expired_time_blocks_even_active_status() {
        assertFalse(ActivationCheckResponse("active", expiresAt = 999L).canUse(1000L))
    }

    @Test fun blocked_and_expired_states_cannot_use() {
        assertFalse(ActivationCheckResponse("blocked").canUse(1000L))
        assertFalse(ActivationCheckResponse("expired").canUse(1000L))
    }
}
