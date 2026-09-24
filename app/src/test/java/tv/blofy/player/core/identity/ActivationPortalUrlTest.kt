package tv.blofy.player.core.identity

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class ActivationPortalUrlTest {
    @Test
    fun productionApiUrlOpensCanonicalConnectPortal() {
        assertEquals(
            "https://blofyplayer.com/connect#deviceId=BLOFY-66HL-GB09&code=123456",
            ActivationPortalUrl.create(
                "https://api.blofyplayer.com/",
                "BLOFY-66HL-GB09",
                "123456"
            )
        )
    }

    @Test
    fun apiSubdomainUsesMatchingPublicOriginAndDropsApiPath() {
        assertEquals(
            "https://example.com/connect#deviceId=BLOFY-ABCD-EF12&code=000042",
            ActivationPortalUrl.create(
                "https://api.example.com/api/v1/?stale=1",
                "BLOFY-ABCD-EF12",
                "000042"
            )
        )
    }

    @Test
    fun regularHttpsOriginUsesConnectPath() {
        assertEquals(
            "https://portal.example.com/connect#deviceId=BLOFY-ABCD-EF12&code=654321",
            ActivationPortalUrl.create(
                "https://portal.example.com/api/",
                "BLOFY-ABCD-EF12",
                "654321"
            )
        )
    }

    @Test
    fun insecureOrInvalidValuesDoNotProduceQrUrl() {
        assertNull(ActivationPortalUrl.create("http://example.com", "BLOFY-ABCD-EF12", "123456"))
        assertNull(ActivationPortalUrl.create("https://example.com", "BLOFY-ABCD-EF12", "12345"))
        assertNull(ActivationPortalUrl.create("https://example.com", "", "123456"))
    }
}
