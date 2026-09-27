package tv.blofy.player.core.network

import java.net.InetAddress
import java.net.UnknownHostException
import okhttp3.Dns
import org.junit.Assert.assertEquals
import org.junit.Assert.assertSame
import org.junit.Assert.fail
import org.junit.Test

class BlofyNetworkDnsTest {
    private fun address(a: Int, b: Int, c: Int, d: Int): InetAddress =
        InetAddress.getByAddress(byteArrayOf(a.toByte(), b.toByte(), c.toByte(), d.toByte()))

    @Test
    fun systemDnsRemainsTheFastPath() {
        val expected = listOf(address(10, 0, 0, 1))
        var fallbackCalls = 0
        val dns = ResilientBlofyDns(
            system = object : Dns {
                override fun lookup(hostname: String) = expected
            },
            fallback = object : Dns {
                override fun lookup(hostname: String): List<InetAddress> {
                    fallbackCalls++
                    return listOf(address(1, 1, 1, 1))
                }
            },
            fallbackHosts = setOf("api.blofyplayer.com")
        )

        assertSame(expected, dns.lookup("api.blofyplayer.com"))
        assertEquals(0, fallbackCalls)
    }

    @Test
    fun blofyHostFallsBackAfterUnknownHost() {
        val expected = listOf(address(104, 18, 1, 1))
        var fallbackCalls = 0
        val dns = ResilientBlofyDns(
            system = object : Dns {
                override fun lookup(hostname: String): List<InetAddress> {
                    throw UnknownHostException("system resolver failed")
                }
            },
            fallback = object : Dns {
                override fun lookup(hostname: String): List<InetAddress> {
                    fallbackCalls++
                    return expected
                }
            },
            fallbackHosts = setOf("api.blofyplayer.com")
        )

        assertSame(expected, dns.lookup("api.blofyplayer.com"))
        assertEquals(1, fallbackCalls)
    }

    @Test
    fun thirdPartyHostsNeverUseBlofyFallback() {
        val original = UnknownHostException("provider DNS failed")
        var fallbackCalls = 0
        val dns = ResilientBlofyDns(
            system = object : Dns {
                override fun lookup(hostname: String): List<InetAddress> = throw original
            },
            fallback = object : Dns {
                override fun lookup(hostname: String): List<InetAddress> {
                    fallbackCalls++
                    return listOf(address(1, 1, 1, 1))
                }
            },
            fallbackHosts = setOf("api.blofyplayer.com")
        )

        try {
            dns.lookup("customer-xtream.example")
            fail("third-party DNS failure must pass through unchanged")
        } catch (error: UnknownHostException) {
            assertSame(original, error)
        }
        assertEquals(0, fallbackCalls)
    }
}
