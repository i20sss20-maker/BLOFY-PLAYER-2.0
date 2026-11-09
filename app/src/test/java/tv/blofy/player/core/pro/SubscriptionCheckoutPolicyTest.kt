package tv.blofy.player.core.pro

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SubscriptionCheckoutPolicyTest {
    @Test fun googlePlayBuildNeverRoutesToWebsiteCheckout() {
        val channel = SubscriptionCheckoutPolicy.channel(isGooglePlayBuild = true)
        assertEquals(PaymentChannel.GOOGLE_PLAY, channel)
        assertFalse(SubscriptionCheckoutPolicy.isOffPlatformCheckoutAllowed(channel))
        assertFalse(SubscriptionCheckoutPolicy.checkoutReady(channel))
    }

    @Test fun websiteBuildUsesOwnPaymentChannelButDoesNotChargeYet() {
        val channel = SubscriptionCheckoutPolicy.channel(isGooglePlayBuild = false)
        assertEquals(PaymentChannel.BLOFY_WEBSITE, channel)
        assertTrue(SubscriptionCheckoutPolicy.isOffPlatformCheckoutAllowed(channel))
        assertFalse(SubscriptionCheckoutPolicy.checkoutReady(channel))
    }

    @Test fun bothChannelsExposeAnnualOnlyCatalog() {
        assertEquals(0, SubscriptionCheckoutPolicy.annualPriceSar(PlayerPlan.FREE))
        assertEquals(19, SubscriptionCheckoutPolicy.annualPriceSar(PlayerPlan.PRO))
        assertEquals(49, SubscriptionCheckoutPolicy.annualPriceSar(PlayerPlan.VIP))
        assertEquals("blofy_player_pro", SubscriptionCheckoutPolicy.productId(PlayerPlan.PRO))
        assertEquals("blofy_player_vip", SubscriptionCheckoutPolicy.productId(PlayerPlan.VIP))
    }
}
