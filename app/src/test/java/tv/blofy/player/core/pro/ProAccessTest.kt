package tv.blofy.player.core.pro

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ProAccessTest {
    private val now = 1_800_000_000_000L

    @Test fun premiumLockedBeforePlayVerificationExists() {
        ProFeature.values().forEach { feature ->
            assertFalse(ProAccess.canUse(feature, ProAccess.current(), now))
        }
    }

    @Test fun localOrUnverifiedPurchaseCannotEnablePro() {
        val unverified = ProEntitlement(false, true, now + 10_000, "blofy_player_pro")
        assertFalse(ProAccess.canUse(ProFeature.SMART_LIBRARY, unverified, now))
    }

    @Test fun verifiedWrongProductOrExpiredSubscriptionIsRejected() {
        val wrong = ProEntitlement(true, true, now + 10_000, "some_other_product")
        val expired = ProEntitlement(true, true, now, "blofy_player_pro")
        val inactive = ProEntitlement(true, false, now + 10_000, "blofy_player_pro")
        listOf(wrong, expired, inactive).forEach {
            assertFalse(ProAccess.canUse(ProFeature.CLOUD_BACKUP, it, now))
        }
    }

    @Test fun verifiedActiveProCanEnableFutureFeature() {
        val valid = ProEntitlement(true, true, now + 10_000, "blofy_player_pro")
        assertTrue(ProAccess.canUse(ProFeature.CLOUD_BACKUP, valid, now))
    }
}
