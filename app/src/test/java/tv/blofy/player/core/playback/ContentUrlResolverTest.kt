package tv.blofy.player.core.playback

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Test
import tv.blofy.player.core.provider.ProviderKind
import tv.blofy.player.core.provider.ProviderProfile
import tv.blofy.player.data.local.ProviderEntity
import tv.blofy.player.data.local.StreamEntity

class ContentUrlResolverTest {
    private val xtreamProfile = ProviderProfile(
        providerKey = "xtream-under-test",
        providerKind = ProviderKind.XTREAM
    )

    @Test
    fun hiddenPublicDirectSourceIsPrimaryPlaybackRouteWithCanonicalXtreamFallback() {
        val provider = ProviderEntity(
            id = "p1",
            name = "provider",
            baseUrl = "http://panel.example.com",
            username = "user",
            password = "pass"
        )
        val stream = StreamEntity(
            key = "p1:live:100",
            providerId = "p1",
            remoteId = "100",
            categoryId = null,
            kind = "live",
            name = "channel",
            directSource = "http://cf.tstor8k.xyz/live/user/pass/100.ts"
        )

        val primary = ContentUrlResolver.live(provider, xtreamProfile, stream)
        assertEquals("http://cf.tstor8k.xyz/live/user/pass/100.ts", primary)
        assertEquals(
            "http://panel.example.com/live/user/pass/100.ts",
            ContentUrlResolver.liveFallback(provider, xtreamProfile, stream)
        )

        val legacyFallback = ContentUrlResolver.directFallback(stream)
        assertEquals("http://panel.example.com/live/user/pass/100.ts", legacyFallback)
        assertNotEquals(primary, legacyFallback)
    }

    @Test
    fun hiddenHostFallbackUsesCanonicalXtreamBeforeProviderOriginPathRewrite() {
        val provider = ProviderEntity(
            id = "hidden-path",
            name = "provider",
            baseUrl = "http://panel.example.com:8080",
            username = "user",
            password = "pass"
        )
        val stream = StreamEntity(
            key = "hidden-path:movie:77",
            providerId = "hidden-path",
            remoteId = "77",
            categoryId = null,
            kind = "movie",
            name = "movie",
            extension = "mkv",
            directSource = "http://cf.tstor8k.xyz:9090/tokenized/media/77?token=abc&edge=4"
        )

        assertEquals(
            "http://cf.tstor8k.xyz:9090/tokenized/media/77?token=abc&edge=4",
            ContentUrlResolver.movie(provider, stream)
        )
        assertEquals(
            "http://panel.example.com:8080/movie/user/pass/77.mkv",
            ContentUrlResolver.movieFallback(provider, stream)
        )
    }

    @Test
    fun movieProviderAwareCompatibilityFallbackIsDistinct() {
        val provider = ProviderEntity(
            id = "movie-provider",
            name = "provider",
            baseUrl = "https://panel.example.com",
            username = "user",
            password = "pass"
        )
        val stream = StreamEntity(
            key = "movie-provider:movie:77",
            providerId = "movie-provider",
            remoteId = "77",
            categoryId = null,
            kind = "movie",
            name = "movie",
            extension = "mkv",
            directSource = "https://cdn.example.net/movie/user/pass/77.mkv"
        )

        val primary = ContentUrlResolver.movie(provider, stream)
        val fallback = ContentUrlResolver.directFallback(provider, stream)
        assertEquals("https://cdn.example.net/movie/user/pass/77.mkv", primary)
        assertEquals("https://panel.example.com/movie/user/pass/77.mkv", fallback)
        assertNotEquals(primary, fallback)
    }

    @Test
    fun canonicalRouteHasNoDuplicateConfiguredFallbackWhenDirectSourceMissing() {
        val provider = ProviderEntity(
            id = "p1",
            name = "provider",
            baseUrl = "http://panel.example.com",
            username = "user",
            password = "pass"
        )
        val stream = StreamEntity(
            key = "p1:live:100",
            providerId = "p1",
            remoteId = "100",
            categoryId = null,
            kind = "live",
            name = "channel"
        )
        assertEquals(
            "http://panel.example.com/live/user/pass/100.ts",
            ContentUrlResolver.live(provider, xtreamProfile, stream)
        )
        assertNull(ContentUrlResolver.liveFallback(provider, xtreamProfile, stream))
        assertNull(ContentUrlResolver.directFallback(stream))
    }

    @Test
    fun retriesTsAsHlsWithoutChangingQuery() {
        assertEquals(
            "https://example.com/live/user/pass/100.m3u8?token=test",
            ContentUrlResolver.alternateLiveFormat(
                "https://example.com/live/user/pass/100.ts?token=test",
                xtreamProfile
            )
        )
    }

    @Test
    fun retriesHlsAsTsWithoutChangingFragment() {
        assertEquals(
            "https://example.com/live/user/pass/100.ts#live",
            ContentUrlResolver.alternateLiveFormat(
                "https://example.com/live/user/pass/100.M3U8#live",
                xtreamProfile
            )
        )
    }

    @Test
    fun ignoresNonLiveSuffix() {
        assertNull(ContentUrlResolver.alternateLiveFormat("https://example.com/movie/100.mp4", xtreamProfile))
    }

    @Test
    fun ignoresNonXtreamLivePathForXtreamProvider() {
        assertNull(
            ContentUrlResolver.alternateLiveFormat(
                "https://cdn.example.com/channels/100.ts",
                xtreamProfile
            )
        )
    }

    @Test
    fun automaticExternalFallbackIsDisabledByDefault() {
        assertFalse(ProviderProfile(providerKey = "provider-under-test").allowVlcFallback)
    }
}
