package tv.blofy.player.core.identity

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ActivationCheckResponseTest {
    @Test
    fun activeWithoutExpiryCanUse() {
        val response = ActivationCheckResponse(status = "active")
        assertEquals(ActivationCheckResponse.State.ACTIVE, response.state())
        assertTrue(response.canUse(nowMs = 1_000L))
    }

    @Test
    fun trialBeforeExpiryCanUse() {
        val response = ActivationCheckResponse(status = "trial", expiresAt = 10_000L, serverTime = 5_000L)
        assertEquals(ActivationCheckResponse.State.TRIAL, response.state())
        assertTrue(response.canUse())
    }

    @Test
    fun activeAfterExpiryCannotUse() {
        val response = ActivationCheckResponse(status = "active", expiresAt = 4_999L, serverTime = 5_000L)
        assertFalse(response.canUse())
    }

    @Test
    fun expiredAndBlockedNeverCanUse() {
        assertFalse(ActivationCheckResponse(status = "expired", expiresAt = Long.MAX_VALUE).canUse(nowMs = 1L))
        assertFalse(ActivationCheckResponse(status = "blocked", expiresAt = Long.MAX_VALUE).canUse(nowMs = 1L))
    }

    @Test
    fun unknownStateIsDenied() {
        val response = ActivationCheckResponse(status = "something-new")
        assertEquals(ActivationCheckResponse.State.UNKNOWN, response.state())
        assertFalse(response.canUse(nowMs = 1L))
    }
}
