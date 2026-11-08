package tv.blofy.player.core.identity

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import tv.blofy.player.data.local.ActivationEntity

class VerifiedActivationLeaseTest {
    private val verifiedAt = 2_000L
    private val serverNow = 1_780_000_000_000L
    private val active = ActivationEntity(
        deviceId = "BLOFY-ABCD-EFGH",
        activationCode = "123456",
        activated = true,
        expiresAt = serverNow + 60_000L,
        lastCheckAt = 1L // Deliberately skewed Android TV wall clock
    )

    @Test fun serverTimeAndMonotonicElapsedIgnoreIncorrectDeviceClock() {
        assertTrue(VerifiedActivationLease.allowsAt(active, serverNow, verifiedAt, verifiedAt))
        assertTrue(VerifiedActivationLease.allowsAt(active, serverNow, verifiedAt, verifiedAt + 59_999L))
        assertFalse(VerifiedActivationLease.allowsAt(active, serverNow, verifiedAt, verifiedAt + 60_000L))
    }

    @Test fun rebootAndOfflineGraceCannotExtendTheSubscription() {
        val lifetime = active.copy(expiresAt = null)
        assertFalse(VerifiedActivationLease.allowsAt(lifetime, serverNow, verifiedAt, verifiedAt - 1L))
        assertTrue(VerifiedActivationLease.allowsAt(lifetime, serverNow, verifiedAt,
            verifiedAt + ActivationLease.OFFLINE_GRACE_MS))
        assertFalse(VerifiedActivationLease.allowsAt(lifetime, serverNow, verifiedAt,
            verifiedAt + ActivationLease.OFFLINE_GRACE_MS + 1L))
        assertFalse(VerifiedActivationLease.allowsAt(lifetime.copy(activated = false),
            serverNow, verifiedAt, verifiedAt + 1L))
    }
}
