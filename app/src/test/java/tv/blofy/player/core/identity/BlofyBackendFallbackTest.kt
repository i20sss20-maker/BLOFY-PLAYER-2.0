package tv.blofy.player.core.identity

import java.net.UnknownHostException
import javax.net.ssl.SSLHandshakeException
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class BlofyBackendFallbackTest {
    @Test
    fun primaryCustomDomainGetsRailwayFallback() {
        assertEquals(
            listOf(
                "https://api.blofyplayer.com",
                "https://blofy-activation-portal-production.up.railway.app"
            ),
            BlofyBackendFallback.candidates("https://api.blofyplayer.com/")
        )
    }

    @Test
    fun unrelatedEndpointsNeverReceiveBlofyCredentials() {
        assertEquals(
            listOf("https://example.com"),
            BlofyBackendFallback.candidates("https://example.com/")
        )
    }

    @Test
    fun dnsFailureCanFailOverButTlsFailureCannot() {
        assertTrue(BlofyBackendFallback.shouldFailOver(UnknownHostException("dns")))
        assertFalse(BlofyBackendFallback.shouldFailOver(SSLHandshakeException("tls")))
    }
}
