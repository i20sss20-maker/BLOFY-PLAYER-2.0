package tv.blofy.player.core.network

import java.net.InetAddress
import java.net.UnknownHostException
import okhttp3.Dns
import org.junit.Assert.assertEquals
import org.junit.Assert.assertSame
import org.junit.Assert.fail
import org.junit.Test

class ProviderCatalogDnsTest {
    private fun address(a: Int, b: Int, c: Int, d: Int): InetAddress =
        InetAddress.getByAddress(byteArrayOf(a.toByte(), b.toByte(), c.toByte(), d.toByte()))

    @Test
    fun systemDnsRemainsFastPath() {
        val expected = listOf(address(10, 0, 0, 1))
        var fallbackCalls = 0
        val dns = ResilientProviderDns(
            system = object : Dns {
                override fun lookup(hostname: String) = expected
            },
            fallbacks = listOf(object : Dns {
                override fun lookup(hostname: String): List<InetAddress> {
                    fallbackCalls++
                    return listOf(address(1, 1, 1, 1))
                }
            })
        )

        assertSame(expected, dns.lookup("provider.example"))
        assertEquals(0, fallbackCalls)
    }

    @Test
    fun publicProviderFallsBackAfterUnknownHost() {
        val expected = listOf(address(104, 18, 10, 20))
        var fallbackCalls = 0
        val dns = ResilientProviderDns(
            system = object : Dns {
                override fun lookup(hostname: String): List<InetAddress> =
                    throw UnknownHostException("system resolver failed")
            },
            fallbacks = listOf(object : Dns {
                override fun lookup(hostname: String): List<InetAddress> {
                    fallbackCalls++
                    return expected
                }
            })
        )

        assertSame(expected, dns.lookup("cf.tstor8k.xyz"))
        assertEquals(1, fallbackCalls)
    }

    @Test
    fun secondFallbackIsTriedWhenFirstAlsoFails() {
        val expected = listOf(address(8, 8, 8, 8))
        var calls = 0
        val dns = ResilientProviderDns(
            system = object : Dns {
                override fun lookup(hostname: String): List<InetAddress> =
                    throw UnknownHostException("system resolver failed")
            },
            fallbacks = listOf(
                object : Dns {
                    override fun lookup(hostname: String): List<InetAddress> {
                        calls++
                        throw UnknownHostException("first fallback failed")
                    }
                },
                object : Dns {
                    override fun lookup(hostname: String): List<InetAddress> {
                        calls++
                        return expected
                    }
                }
            )
        )

        assertSame(expected, dns.lookup("provider.example"))
        assertEquals(2, calls)
    }

    @Test
    fun localNamesNeverLeaveSystemResolver() {
        val names = listOf(
            "localhost",
            "box.local",
            "panel.internal",
            "receiver.lan",
            "server.home",
            "server.home.arpa",
            "singlelabel",
            "192.168.1.20"
        )

        for (name in names) {
            val original = UnknownHostException("local DNS failed")
            var fallbackCalls = 0
            val dns = ResilientProviderDns(
                system = object : Dns {
                    override fun lookup(hostname: String): List<InetAddress> = throw original
                },
                fallbacks = listOf(object : Dns {
                    override fun lookup(hostname: String): List<InetAddress> {
                        fallbackCalls++
                        return listOf(address(1, 1, 1, 1))
                    }
                })
            )

            try {
                dns.lookup(name)
                fail("local/private hostname must not use public fallback: $name")
            } catch (error: UnknownHostException) {
                assertSame(original, error)
            }
            assertEquals(0, fallbackCalls)
        }
    }
}
