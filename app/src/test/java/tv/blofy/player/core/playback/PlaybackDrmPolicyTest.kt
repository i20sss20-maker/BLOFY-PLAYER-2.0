package tv.blofy.player.core.playback

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class PlaybackDrmPolicyTest {
    @Test
    fun acceptsExplicitHttpsLicenseEndpoint() {
        val license = "https://drm.example.com/widevine?session=abc"
        assertEquals(license, PlaybackDrmPolicy.authorizedWidevineLicenseUrl(license))
    }

    @Test
    fun rejectsCleartextAndUntrustedUrlSyntax() {
        assertNull(PlaybackDrmPolicy.authorizedWidevineLicenseUrl("http://drm.example.com/license"))
        assertNull(PlaybackDrmPolicy.authorizedWidevineLicenseUrl("https://user:password@drm.example.com/license"))
        assertNull(PlaybackDrmPolicy.authorizedWidevineLicenseUrl("https://drm.example.com/license#fragment"))
        assertNull(PlaybackDrmPolicy.authorizedWidevineLicenseUrl("javascript:alert(1)"))
        assertNull(PlaybackDrmPolicy.authorizedWidevineLicenseUrl("https:///missing-host"))
        assertNull(PlaybackDrmPolicy.authorizedWidevineLicenseUrl(""))
        assertNull(PlaybackDrmPolicy.authorizedWidevineLicenseUrl(null))
    }
}
