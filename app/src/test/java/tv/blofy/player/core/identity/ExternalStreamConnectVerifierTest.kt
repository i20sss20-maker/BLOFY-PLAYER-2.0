package tv.blofy.player.core.identity

import org.junit.Assert.*
import org.junit.Test
import java.net.InetAddress

class ExternalStreamConnectVerifierTest {
    @Test fun publicAddressRejectsLocalAndReservedTargets() {
        for (ip in listOf("127.0.0.1","10.0.0.1","172.16.1.1","192.168.1.1","169.254.169.254","100.64.0.1","0.0.0.0","224.0.0.1","198.18.0.1","::1","fe80::1","fc00::1","::ffff:127.0.0.1","2001:db8::1"))
            assertFalse(ip, ExternalStreamConnectVerifier.publicAddress(InetAddress.getByName(ip)))
        assertTrue(ExternalStreamConnectVerifier.publicAddress(InetAddress.getByName("8.8.8.8")))
        assertTrue(ExternalStreamConnectVerifier.publicAddress(InetAddress.getByName("2606:4700::1111")))
    }
    @Test fun statusNeverAssumesUnrecognizedAccountIsActive() {
        val c = ExternalStreamConnectVerifier
        assertEquals(ExternalStreamConnectVerifier.Status.ACTIVE,c.classify("1","Active"))
        assertEquals(ExternalStreamConnectVerifier.Status.INACTIVE,c.classify("1","Expired"))
        assertEquals(ExternalStreamConnectVerifier.Status.INACTIVE,c.classify("0","Active"))
        assertEquals(ExternalStreamConnectVerifier.Status.UNAVAILABLE,c.classify("1",""))
    }
}
