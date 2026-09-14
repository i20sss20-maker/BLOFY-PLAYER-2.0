package tv.blofy.player.core.playback

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertNotEquals
import org.junit.Test
import tv.blofy.player.core.provider.ProviderKind
import tv.blofy.player.core.provider.ProviderProfile
import tv.blofy.player.data.local.ProviderEntity
import tv.blofy.player.data.local.StreamEntity

class LiveRouteParityRegressionTest {
    private val profile = ProviderProfile(
        providerKey = "provider",
        providerKind = ProviderKind.XTREAM
    )

    @Test fun hiddenPublicHostProducesOneSharedPrimaryAndCanonicalXtreamFallbackPair() {
        val provider = ProviderEntity(
            id = "provider",
            name = "provider",
            baseUrl = "http://panel.example.com:8080",
            username = "user",
            password = "pass"
        )
        val stream = StreamEntity(
            key = "provider:live:100",
            providerId = provider.id,
            remoteId = "100",
            categoryId = "news",
            kind = "live",
            name = "News",
            directSource = "http://cf.tstor8k.xyz:9090/live/user/pass/100.ts?token=a1"
        )

        val route = ContentUrlResolver.liveRoute(provider, profile, stream)
        assertEquals("http://cf.tstor8k.xyz:9090/live/user/pass/100.ts?token=a1", route.primaryUrl)
        assertEquals("http://panel.example.com:8080/live/user/pass/100.ts", route.fallbackUrl)
        assertNotEquals(route.primaryUrl, route.fallbackUrl)
        assertEquals(route.primaryUrl, ContentUrlResolver.live(provider, profile, stream))
        assertEquals(route.fallbackUrl, ContentUrlResolver.liveFallback(provider, profile, stream))
        assertEquals(route.fallbackUrl, ContentUrlResolver.directFallback(provider, stream))
    }

    @Test fun internalDirectSourceIsRepairedBeforePlaybackAndNeedsNoDuplicateFallback() {
        val provider = ProviderEntity(
            id = "provider",
            name = "provider",
            baseUrl = "https://panel.example.com:9443",
            username = "user",
            password = "pass"
        )
        val stream = StreamEntity(
            key = "provider:live:101",
            providerId = provider.id,
            remoteId = "101",
            categoryId = "sports",
            kind = "live",
            name = "Sports",
            directSource = "http://10.0.0.8/live/user/pass/101.ts"
        )

        val route = ContentUrlResolver.liveRoute(provider, profile, stream)
        assertEquals("https://panel.example.com:9443/live/user/pass/101.ts", route.primaryUrl)
        assertNull(route.fallbackUrl)
    }

    @Test fun missingDirectSourceUsesCanonicalXtreamRouteWithoutFallback() {
        val provider = ProviderEntity(
            id = "provider",
            name = "provider",
            baseUrl = "http://panel.example.com",
            username = "user",
            password = "pass"
        )
        val stream = StreamEntity(
            key = "provider:live:102",
            providerId = provider.id,
            remoteId = "102",
            categoryId = "sports",
            kind = "live",
            name = "Sports 2"
        )

        val route = ContentUrlResolver.liveRoute(provider, profile, stream)
        assertEquals("http://panel.example.com/live/user/pass/102.ts", route.primaryUrl)
        assertNull(route.fallbackUrl)
    }
}
