package tv.blofy.player.core.playback

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ProviderHostResolverTest {
    @Test
    fun replaces_private_ipv4_with_complete_provider_origin() {
        val resolved = ProviderHostResolver.resolve(
            "https://panel.example.com:8443",
            "http://192.168.10.5:8080/live/u/p/12.ts?token=x"
        )
        assertEquals("https://panel.example.com:8443/live/u/p/12.ts?token=x", resolved)
    }

    @Test
    fun replaces_internal_dns_with_complete_provider_origin() {
        val resolved = ProviderHostResolver.resolve(
            "http://iptv.example.com:8080",
            "https://stream.internal:9443/movie/u/p/77.mp4"
        )
        assertEquals("http://iptv.example.com:8080/movie/u/p/77.mp4", resolved)
    }

    @Test
    fun preserves_public_cdn_during_primary_resolution() {
        val source = "https://cdn.example.net:9443/vod/77.mp4?x=1"
        assertEquals(source, ProviderHostResolver.resolve("https://iptv.example.com", source))
    }

    @Test
    fun builds_provider_origin_fallback_for_public_looking_hidden_host() {
        val fallback = ProviderHostResolver.providerOriginFallback(
            "https://panel.example.com:8443",
            "http://cf.hidden.example:8080/live/u/p/12.ts?token=x"
        )
        assertEquals("https://panel.example.com:8443/live/u/p/12.ts?token=x", fallback)
    }

    @Test
    fun provider_origin_fallback_is_absent_when_origin_already_matches() {
        assertNull(
            ProviderHostResolver.providerOriginFallback(
                "https://panel.example.com:8443",
                "https://panel.example.com:8443/movie/u/p/77.mp4"
            )
        )
    }

    @Test
    fun detects_single_label_and_private_ranges() {
        assertTrue(ProviderHostResolver.isClearlyInternal("backend"))
        assertTrue(ProviderHostResolver.isClearlyInternal("10.2.3.4"))
        assertTrue(ProviderHostResolver.isClearlyInternal("172.20.2.4"))
        assertTrue(ProviderHostResolver.isClearlyInternal("192.168.1.20"))
    }
}
