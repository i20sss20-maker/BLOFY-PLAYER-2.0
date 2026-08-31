package tv.blofy.player.core.diagnostics

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class DiagnosticsSanitizerTest {
    @Test
    fun redactsXtreamUserInfoPathQueryAndFragment() {
        val sanitized = DiagnosticsSanitizer.sanitizeUrl(
            "https://authority-user:authority-pass@IPTV.Example:8443/live/alice/p%40ssword/12345.ts" +
                "?username=query-user&password=query-pass&token=query-token#fragment-token"
        )

        assertEquals("https://redacted.invalid/live/***.ts", sanitized)
        listOf(
            "iptv.example", "authority-user", "authority-pass", "alice", "p%40ssword", "query-user",
            "query-pass", "query-token"
        )
            .forEach { secret -> assertFalse(sanitized.contains(secret, ignoreCase = true)) }
    }

    @Test
    fun redactsM3uQueryAndUnknownPaths() {
        assertEquals(
            "https://redacted.invalid/***.php",
            DiagnosticsSanitizer.sanitizeUrl(
                "https://provider.example/get.php?username=alice&password=secret&type=m3u_plus&token=abc"
            )
        )
        assertEquals("<redacted-url>", DiagnosticsSanitizer.sanitizeUrl("not a valid URL?token=abc"))
    }

    @Test
    fun removesEmbeddedUrlsCredentialsAndTokensFromErrors() {
        val sanitized = DiagnosticsSanitizer.sanitizeMessage(
            "Failed https://url-user:url-pass@iptv.example/series/alice/secret/42.mkv?token=url-token " +
                "username=plain-user password: plain-pass token='plain-token' Authorization: Bearer eyJ.secret.sig " +
                "JSON={\"username\":\"json-user\",\"password\":\"json-pass\",\"access_token\":\"json-token\"}"
        ).orEmpty()

        assertTrue(sanitized.contains("<redacted-url>"))
        listOf(
            "iptv.example", "url-user", "url-pass", "alice", "secret", "url-token", "plain-user", "plain-pass",
            "plain-token", "eyJ.secret.sig", "json-user", "json-pass", "json-token"
        ).forEach { secret -> assertFalse("Leaked $secret in: $sanitized", sanitized.contains(secret)) }
        assertFalse(sanitized.contains("http://"))
        assertFalse(sanitized.contains("https://"))
    }

    @Test
    fun removesSchemeLessUrlsAndUriValuesFromErrors() {
        val sanitized = DiagnosticsSanitizer.sanitizeMessage(
            "source=provider.example/live/alice/password/99.ts uri=https%3A%2F%2Fprovider.example%2Fget.php%3Ftoken%3Dabc"
        ).orEmpty()

        assertFalse(sanitized.contains("provider.example"))
        assertFalse(sanitized.contains("alice"))
        assertFalse(sanitized.contains("password/99"))
        assertFalse(sanitized.contains("token%3Dabc"))
    }

    @Test
    fun removesBareHostsIpAddressesBasicAuthAndRelativePaths() {
        val sanitized = DiagnosticsSanitizer.sanitizeMessage(
            "Unable to resolve provider.example.com; ETIMEDOUT 203.0.113.42:8080 " +
                "Authorization: Basic YWxpY2U6c2VjcmV0 uri=/live/path-user/path-pass/1.ts"
        ).orEmpty()

        listOf("provider.example.com", "203.0.113.42", "YWxpY2U6c2VjcmV0", "path-user", "path-pass")
            .forEach { secret -> assertFalse("Leaked $secret in: $sanitized", sanitized.contains(secret)) }
    }

    @Test
    fun pseudonymizesProviderAndAllowlistsMetadata() {
        val provider = DiagnosticsSanitizer.pseudonymizeProviderKey(
            "https://user:pass@provider.example/live/user/pass/1.ts?token=secret"
        )
        assertTrue(provider.matches(Regex("^provider-[a-f0-9]{16}$")))
        assertEquals(provider, DiagnosticsSanitizer.pseudonymizeProviderKey(provider))
        assertFalse(provider.contains("secret"))

        assertEquals("live", DiagnosticsSanitizer.sanitizeContentKind("LIVE"))
        assertEquals("unknown", DiagnosticsSanitizer.sanitizeContentKind("password=secret"))
        assertEquals(
            "ERROR_CODE_IO_NETWORK_CONNECTION_FAILED",
            DiagnosticsSanitizer.sanitizeErrorCode("ERROR_CODE_IO_NETWORK_CONNECTION_FAILED")
        )
        assertEquals(null, DiagnosticsSanitizer.sanitizeErrorCode("token=secret"))
        assertEquals("2.0.0-rc01", DiagnosticsSanitizer.sanitizeAppVersion("2.0.0-rc01"))
        assertEquals(null, DiagnosticsSanitizer.sanitizeAppVersion("url=https://provider.example"))
    }

    @Test
    fun enforcesOutputLimitsAfterRedaction() {
        assertEquals(24, DiagnosticsSanitizer.sanitizeUrl("https://example.com/live/u/p/1.ts", 24).length)
        assertEquals(32, DiagnosticsSanitizer.sanitizeMessage("failure " + "x".repeat(200), 32)?.length)
    }
}
