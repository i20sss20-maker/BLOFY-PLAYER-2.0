package tv.blofy.player.core.url

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PlaylistUrlPolicyTest {
    @Test
    fun acceptsHttpsProviderAndM3uUrls() {
        assertTrue(PlaylistUrlPolicy.isValid("https://provider.example"))
        assertTrue(PlaylistUrlPolicy.isValid(" https://provider.example/list.m3u?token=abc "))
    }

    @Test
    fun rejectsCleartextAndMalformedUrlsWithSpecificResults() {
        assertEquals(PlaylistUrlPolicy.Result.HTTPS_REQUIRED, PlaylistUrlPolicy.validate("http://provider.example"))
        assertEquals(PlaylistUrlPolicy.Result.INVALID, PlaylistUrlPolicy.validate("provider.example"))
        assertEquals(PlaylistUrlPolicy.Result.EMPTY, PlaylistUrlPolicy.validate("  "))
        assertFalse(PlaylistUrlPolicy.isValid("ftp://provider.example/list.m3u"))
    }
}
