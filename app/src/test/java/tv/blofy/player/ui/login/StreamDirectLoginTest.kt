package tv.blofy.player.ui.login

import org.junit.Assert.*
import org.junit.Test
import tv.blofy.player.core.identity.StreamCodeSession

class StreamDirectLoginTest {
    @Test fun xtreamUsesAnIsolatedProviderWithExplicitCredentials() {
        val result = StreamDirectLogin.xtream("https://example.com:8443/", "user", "secret")!!
        assertEquals("https://example.com:8443", result.host)
        assertEquals("secret", result.password)
        assertNotEquals(StreamCodeSession.providerId, result.provider().id)
        assertTrue(StreamDirectLogin.isDirectId(result.provider().id))
        assertFalse(result.toString().contains("secret"))
    }

    @Test fun m3uExportPreservesDecodedCredentialsAndBasePath() {
        val result = StreamDirectLogin.m3u("https://example.com/panel/get.php?username=a%2Bb&password=p%26q&output=m3u8")!!
        assertEquals("https://example.com/panel", result.host)
        assertEquals("a+b", result.username)
        assertEquals("p&q", result.password)
        assertEquals("m3u8", result.format)
    }

    @Test fun invalidOrAmbiguousLinksNeverBecomeAProvider() {
        assertNull(StreamDirectLogin.xtream("https://blofyplayer.com", "user", "secret"))
        assertNull(StreamDirectLogin.xtream("http://127.0.0.1", "user", "secret"))
        assertNull(StreamDirectLogin.xtream("https://example.com", "", "secret"))
        assertNull(StreamDirectLogin.m3u("https://example.com/playlist.m3u"))
        assertNull(StreamDirectLogin.m3u("https://example.com/get.php?username=a&username=b&password=c"))
    }
}
