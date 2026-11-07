package tv.blofy.player.core.network

import okhttp3.HttpUrl.Companion.toHttpUrl
import org.junit.Assert.*
import org.junit.Test

class BlofyActivationOriginFallbackTest {
    @Test fun officialApiMapsOnlyToOfficialRailwayServiceAndKeepsRequestPath() {
        val original = "https://api.blofyplayer.com/api/v1/activation/check".toHttpUrl()
        val alternate = BlofyActivationOriginFallback.fallbackUrl(original)
        assertNotNull(alternate)
        assertTrue(alternate!!.isHttps)
        assertEquals("blofy-activation-portal-production.up.railway.app", alternate.host)
        assertEquals("/api/v1/activation/check", alternate.encodedPath)
        assertEquals(443, alternate.port)
    }

    @Test fun arbitraryProviderAndNonTlsUrlsAreNeverRerouted() {
        listOf(
            "http://api.blofyplayer.com/api/v1/activation/check",
            "https://provider.example/api/v1/activation/check",
            "https://api.blofyplayer.com:8443/api/v1/activation/check",
            "https://blofyplayer.com/api/v1/activation/check"
        ).forEach { url -> assertNull(BlofyActivationOriginFallback.fallbackUrl(url.toHttpUrl())) }
    }
}
