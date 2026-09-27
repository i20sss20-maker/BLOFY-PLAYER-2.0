package tv.blofy.player.core.network

import java.net.InetAddress
import java.net.UnknownHostException
import okhttp3.Dns
import org.junit.Assert.assertEquals
import org.junit.Assert.assertSame
import org.junit.Assert.fail
import org.junit.Test

class ProviderNetworkDnsTest {
    private fun addr(a: Int, b: Int, c: Int, d: Int): InetAddress =
        InetAddress.getByAddress(byteArrayOf(a.toByte(), b.toByte(), c.toByte(), d.toByte()))

    @Test
    fun systemResolverRemainsPrimary() {
        val expected = listOf(addr(10, 20, 30, 40))
        var fallbackCalls = 0
        val dns = ResilientProviderDns(
            system = object : Dns {
                override fun lookup(hostname: String) = expected
            },
            fallback = object : Dns {
                override fun lookup(hostname: String): List<InetAddress> {
                    fallbackCalls++
                    return listOf(addr(1, 1, 1, 1))
                }
            }
        )

        assertSame(expected, dns.lookup("cf.tstor8k.xyz"))
        assertEquals(0, fallbackCalls)
    }

    @Test
    fun publicProviderFallsBackAfterUnknownHost() {
        val expected = listOf(addr(104, 18, 10, 20))
        var fallbackCalls = 0
        val dns = ResilientProviderDns(
            system = object : Dns {
                override fun lookup(hostname: String): List<InetAddress> {
                    throw UnknownHostException("platform DNS failed")
                }
            },
            fallback = object : Dns {
                override fun lookup(hostname: String): List<InetAddress> {
                    fallbackCalls++
                    return expected
                }
            }
        )

        assertSame(expected, dns.lookup("cf.tstor8k.xyz"))
        assertEquals(1, fallbackCalls)
    }

    @Test
    fun localProviderNamesNeverLeaveDeviceDns() {
        val original = UnknownHostException("local DNS failed")
        var fallbackCalls = 0
        val dns = ResilientProviderDns(
            system = object : Dns {
                override fun lookup(hostname: String): List<InetAddress> = throw original
            },
            fallback = object : Dns {
                override fun lookup(hostname: String): List<InetAddress> {
                    fallbackCalls++
                    return listOf(addr(1, 1, 1, 1))
                }
            }
        )

        for (host in listOf("box.local", "provider.lan", "localhost", "192.168.1.50")) {
            try {
                dns.lookup(host)
                fail("Expected original UnknownHostException for $host")
            } catch (error: UnknownHostException) {
                assertSame(original, error)
            }
        }
        assertEquals(0, fallbackCalls)
    }
}
