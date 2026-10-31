package tv.blofy.player.core.identity

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class ActivationPortalUrlTest {
    @Test
    fun productionUrlIncludesDeviceCredentials() {
        assertEquals(
            "https://blofyplayer.com${if (tv.blofy.player.BuildConfig.IS_GOOGLE_PLAY) "/connect" else "/"}#deviceId=BLOFY-66HL-GB09&code=123456",
            ActivationPortalUrl.create(
                "https://blofyplayer.com/",
                "BLOFY-66HL-GB09",
                "123456"
            )
        )
    }

    @Test
    fun portalUsesProductionOriginEvenWhenBaseContainsApiPath() {
        assertEquals(
            "https://example.com${if (tv.blofy.player.BuildConfig.IS_GOOGLE_PLAY) "/connect" else "/"}#deviceId=BLOFY-ABCD-EF12&code=000042",
            ActivationPortalUrl.create(
                "https://example.com/api/v1/",
                "BLOFY-ABCD-EF12",
                "000042"
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
