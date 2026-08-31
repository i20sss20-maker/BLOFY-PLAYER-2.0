package tv.blofy.player.core.url

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PlaylistUrlPolicyTest {
    @Test
    fun acceptsHttpsProviderAndM3uUrlsAsPreferredTransport() {
        assertTrue(PlaylistUrlPolicy.isValid("https://provider.example"))
        assertTrue(PlaylistUrlPolicy.isValid(" https://provider.example/list.m3u?token=abc "))
        assertTrue(PlaylistUrlPolicy.isValid("https://1.1.1.1:8443/get.php?username=user&password=pass"))
        assertTrue(PlaylistUrlPolicy.isValid("https://[2606:4700:4700::1111]/playlist.m3u"))
        assertEquals(PlaylistUrlPolicy.Result.VALID, PlaylistUrlPolicy.validate("https://provider.example"))
    }

    @Test
    fun acceptsHttpWithAnExplicitClearTextResult() {
        assertEquals(PlaylistUrlPolicy.Result.HTTP_CLEAR_TEXT, PlaylistUrlPolicy.validate("http://provider.example"))
        assertTrue(PlaylistUrlPolicy.isValid("http://provider.example/get.php?username=user&password=pass"))
        assertTrue(PlaylistUrlPolicy.isClearText("http://provider.example"))
        assertFalse(PlaylistUrlPolicy.isClearText("https://provider.example"))
    }

    @Test
    fun rejectsMalformedAndNonHttpUrls() {
        assertEquals(PlaylistUrlPolicy.Result.INVALID, PlaylistUrlPolicy.validate("provider.example"))
        assertEquals(PlaylistUrlPolicy.Result.EMPTY, PlaylistUrlPolicy.validate("  "))
        assertFalse(PlaylistUrlPolicy.isValid("ftp://provider.example/list.m3u"))
        assertFalse(PlaylistUrlPolicy.isValid("file:///sdcard/list.m3u"))
        assertFalse(PlaylistUrlPolicy.isValid("https://provider.example/list name.m3u"))
        assertFalse(PlaylistUrlPolicy.isValid("https://"))
    }

    @Test
    fun rejectsAuthorityCredentials() {
        assertEquals(
            PlaylistUrlPolicy.Result.USER_INFO_NOT_ALLOWED,
            PlaylistUrlPolicy.validate("https://user:pass@provider.example/list.m3u")
        )
        assertEquals(
            PlaylistUrlPolicy.Result.USER_INFO_NOT_ALLOWED,
            PlaylistUrlPolicy.validate("http://@provider.example/list.m3u")
        )
    }

    @Test
    fun rejectsLocalAndPrivateEndpoints() {
        listOf(
            "http://localhost:8080",
            "http://provider.local/list.m3u",
            "http://server/list.m3u",
            "http://127.0.0.1/list.m3u",
            "http://10.0.0.1/list.m3u",
            "http://172.16.0.1/list.m3u",
            "http://192.168.1.10/list.m3u",
            "http://169.254.1.1/list.m3u",
            "http://[::1]/list.m3u",
            "http://[fc00::1]/list.m3u",
            "http://[fe80::1]/list.m3u"
        ).forEach { value ->
            assertEquals(value, PlaylistUrlPolicy.Result.UNSAFE_HOST, PlaylistUrlPolicy.validate(value))
            assertFalse(value, PlaylistUrlPolicy.isValid(value))
        }
    }
}
