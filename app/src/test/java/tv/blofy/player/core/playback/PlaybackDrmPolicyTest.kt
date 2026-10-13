package tv.blofy.player.core.playback

import androidx.media3.common.MimeTypes
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class PlaybackDrmPolicyTest {
    @Test
    fun acceptsProviderSuppliedHttpsLicenseUriWithoutStrippingQuery() {
        val uri = "https://license.example.test/widevine?session=authorized"
        assertEquals(uri, PlaybackDrmPolicy.validatedLicenseUri("  $uri  "))
    }

    @Test
    fun rejectsNonHttpsCredentialsFragmentsAndMalformedUris() {
        assertNull(PlaybackDrmPolicy.validatedLicenseUri(null))
        assertNull(PlaybackDrmPolicy.validatedLicenseUri("http://license.example.test/widevine"))
        assertNull(PlaybackDrmPolicy.validatedLicenseUri("https://user:pass@license.example.test/widevine"))
        assertNull(PlaybackDrmPolicy.validatedLicenseUri("https://license.example.test/widevine#secret"))
        assertNull(PlaybackDrmPolicy.validatedLicenseUri("file:///tmp/license"))
        assertNull(PlaybackDrmPolicy.validatedLicenseUri("not an uri"))
        assertNull(PlaybackDrmPolicy.validatedLicenseUri("https://license.example.test:0/path"))
    }

    @Test
    fun drmOnlyAppliesToAdaptiveStreamsWithExplicitLicense() {
        assertTrue(PlaybackDrmPolicy.canAttachWidevine(MimeTypes.APPLICATION_MPD))
        assertTrue(PlaybackDrmPolicy.canAttachWidevine(MimeTypes.APPLICATION_M3U8))
        assertFalse(PlaybackDrmPolicy.canAttachWidevine(null))
        assertFalse(PlaybackDrmPolicy.canAttachWidevine("video/mp4"))
    }
