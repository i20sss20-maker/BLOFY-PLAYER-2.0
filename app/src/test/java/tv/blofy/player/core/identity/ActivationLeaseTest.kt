package tv.blofy.player.core.identity

import org.junit.Assert.*
import org.junit.Test
import tv.blofy.player.data.local.ActivationEntity

class ActivationLeaseTest {
    private val now = 2_000_000_000_000L
    private val licensed = ActivationEntity(deviceId = "BLOFY-ABCD-EFGH", activationCode = "123456", activated = true, expiresAt = null, lastCheckAt = now)
    @Test fun aLifetimeLicenseStillNeedsPeriodicRevalidation() {
        assertTrue(ActivationLease.allows(licensed, now))
        assertTrue(ActivationLease.allows(licensed, now + ActivationLease.OFFLINE_GRACE_MS))
        assertFalse(ActivationLease.allows(licensed, now + ActivationLease.OFFLINE_GRACE_MS + 1))
    }
    @Test fun revocationExpiryAndClockRollbackDoNotReceiveAnOfflineGrant() {
        assertFalse(ActivationLease.allows(licensed.copy(activated = false), now))
        assertFalse(ActivationLease.allows(licensed.copy(expiresAt = now), now))
        assertFalse(ActivationLease.allows(licensed, now - 1000))
    }
}
