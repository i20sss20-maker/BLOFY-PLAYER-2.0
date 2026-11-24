package tv.blofy.player.core.identity

import org.junit.Assert.*
import org.junit.Test

class ExternalStreamConnectClientTest {
    @Test fun pairingCodePreservesCaseAndDoesNotAcceptLegacyCodes() {
        val code = "BC-AbCdEf0123456789_-xyZabc"
        assertEquals(code, ExternalStreamConnectClient.normalizeCode(" $code "))
        assertNull(ExternalStreamConnectClient.normalizeCode(code.uppercase().replace("BC-", "bc-")))
        assertEquals("12345678",ExternalStreamConnectClient.normalizeCode("12345678"))
        assertEquals("01234567",ExternalStreamConnectClient.normalizeCode("01234567"))
        assertNull(ExternalStreamConnectClient.normalizeCode("1234567"))
        assertEquals("012345678901", ExternalStreamConnectClient.normalizeCode("012345678901"))
        assertNull(ExternalStreamConnectClient.normalizeCode("BC-short"))
    }
    @Test fun hostRequiresHttpOrHttpsOrigin() {
        assertNotNull(ExternalStreamConnectClient.parseHost("https://provider.example.com:8443"))
        assertNotNull(ExternalStreamConnectClient.parseHost("http://provider.example.com:8080"))
        for (host in listOf("ftp://provider.example.com", "https://127.0.0.1", "https://[::1]", "https://localhost", "https://name.internal", "https://user:password@provider.example.com", "https://provider.example.com/path", "https://provider.example.com?x=1")) {
            assertNull(host, ExternalStreamConnectClient.parseHost(host))
        }
    }
}
