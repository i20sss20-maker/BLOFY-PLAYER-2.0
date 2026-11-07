package tv.blofy.player.core.network

import java.net.InetAddress
import java.net.UnknownHostException
import org.junit.Assert.*
import org.junit.Test

class BlofyActivationDnsTest {
    @Test fun fallsBackToSecureDnsForActivationOriginOnly() {
        val expected = listOf(InetAddress.getByAddress(byteArrayOf(1, 2, 3, 4)))
        var calls = 0
        val actual = BlofyActivationDns.lookupWithResolvers(
            "api.blofyplayer.com",
            { throw UnknownHostException("system unavailable") },
            { calls++; expected }
        )
        assertEquals(expected, actual)
        assertEquals(1, calls)
    }

    @Test fun noLeakOfArbitraryHostnamesToSecureResolver() {
        var calls = 0
        try {
            BlofyActivationDns.lookupWithResolvers(
                "provider.example",
                { throw UnknownHostException("system unavailable") },
                { calls++; emptyList() }
            )
            fail("must preserve original DNS error")
        } catch (_: UnknownHostException) {
            assertEquals(0, calls)
        }
    }

    @Test fun successfulSystemDnsDoesNotTriggerAlternateResolver() {
        val expected = listOf(InetAddress.getByAddress(byteArrayOf(1, 2, 3, 4)))
        assertEquals(expected, BlofyActivationDns.lookupWithResolvers(
            "blofy-activation-portal-production.up.railway.app",
            { expected },
            { fail("must not call DoH"); emptyList() }
        ))
    }

    @Test fun secureDnsFailureNeverGrantsAccessOrCreatesAnAddress() {
        try {
            BlofyActivationDns.lookupWithResolvers(
                "api.blofyplayer.com",
                { throw UnknownHostException("system unavailable") },
                { throw UnknownHostException("DoH unavailable") }
            )
            fail("must fail closed")
        } catch (_: UnknownHostException) { }
    }
}
