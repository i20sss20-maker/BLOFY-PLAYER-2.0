package tv.blofy.player.core.pro

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ProAccessPolicyTest {
    private val now = 1_800_000_000_000L

    @Test fun freePlaybackWorksWithoutLoginOrPurchase() {
        AppFeature.values().filter { !it.requiresPro }.forEach {
            assertTrue(ProAccessPolicy.canUse(it, EntitlementSnapshot.FREE, now))
        }
    }

    @Test fun everyProFeatureDeniesUnverifiedState() {
        AppFeature.values().filter { it.requiresPro }.forEach {
            assertFalse(ProAccessPolicy.canUse(it, EntitlementSnapshot.FREE, now))
            assertFalse(
                ProAccessPolicy.canUse(
                    it,
                    EntitlementSnapshot(verified = false, active = true, expiresAtEpochMs = now + 1000, isAppPro = true),
                    now
                )
            )
        }
    }

    @Test fun verifiedActiveAndUnexpiredProAllowsPremiumFeatures() {
        val entitlement = EntitlementSnapshot(
            verified = true, active = true, expiresAtEpochMs = now + 60_000, isAppPro = true
        )
        AppFeature.values().filter { it.requiresPro }.forEach {
            assertTrue(ProAccessPolicy.canUse(it, entitlement, now))
        }
    }

    @Test fun expiredOrInactiveProIsDenied() {
        val expired = EntitlementSnapshot(true, true, now, true)
        val inactive = EntitlementSnapshot(true, false, now + 60_000, true)
        val wrongProduct = EntitlementSnapshot(true, true, now + 60_000, false)
        for (snapshot in listOf(expired, inactive, wrongProduct)) {
            assertFalse(ProAccessPolicy.canUse(AppFeature.CLOUD_BACKUP, snapshot, now))
        }
    }

    @Test fun currentAppDefaultsToFreeAndNeverGrantsPro() {
        assertFalse(ProAccessPolicy.canUse(AppFeature.SMART_LIBRARY, ProAccessPolicy.currentSnapshot(), now))
    }
}
