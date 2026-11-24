package tv.blofy.player.core.identity

import org.junit.Assert.*
import org.junit.Test

class UnifiedStreamCodeClientTest {
    @Test fun singleInputNormalizesBothCodeFamilies() {
        assertEquals("01234567", UnifiedStreamCodeClient.normalize("٠١٢٣ ٤٥٦٧"))
        assertEquals("BC-AbCdEf0123456789_-xyZabc", UnifiedStreamCodeClient.normalize(" BC-AbCdEf0123456789_-xyZabc "))
        assertEquals("AB12AB12AB12AB12AB12AB12", UnifiedStreamCodeClient.normalize("ab12-ab12-ab12-ab12-ab12-ab12"))
        assertNull(UnifiedStreamCodeClient.normalize("BC-short"))
    }

    @Test fun decodesTypedPaidAndExternalResultsSeparately() {
        val token = "v1.12345678-1234-1234-1234-123456789abc." + "a".repeat(43)
        val paid = UnifiedStreamCodeClient.decode("""{"ok":true,"type":"blofy_stream","accessToken":"$token","tokenType":"Bearer","account":{"activatedAt":100,"expiresAt":200}}""")
            as UnifiedStreamCodeClient.Result.Paid
        assertEquals(token, paid.session.accessToken)
        assertEquals(200L, paid.session.expiresAt)
        val external = UnifiedStreamCodeClient.decode("""{"ok":true,"type":"external_xtream","providerVerified":false,"credentials":{"host":"http://provider.example.com:8080","username":"user","password":"secret"}}""")
            as UnifiedStreamCodeClient.Result.External
        assertEquals("http://provider.example.com:8080/", external.credentials.host.toString())
        assertEquals("user", external.credentials.username)
        assertEquals("secret", external.credentials.password)
    }

    @Test fun mixedOrInvalidResponsesCannotCreateSession() {
        for (json in listOf(
            """{"ok":false,"type":"external_xtream"}""",
            """{"ok":true,"type":"unknown"}""",
            """{"ok":true,"type":"external_xtream","providerVerified":true,"credentials":{"host":"https://provider.example.com","username":"u","password":"p"}}""",
            """{"ok":true,"type":"external_xtream","providerVerified":false,"accessToken":"wrong","credentials":{"host":"https://provider.example.com","username":"u","password":"p"}}""",
            """{"ok":true,"type":"external_xtream","providerVerified":false,"credentials":{"host":"http://127.0.0.1","username":"u","password":"p"}}"""
        )) assertTrue(runCatching { UnifiedStreamCodeClient.decode(json) }.isFailure)
    }
}
