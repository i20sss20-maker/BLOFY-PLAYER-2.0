package tv.blofy.player.core.playback

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Test
import tv.blofy.player.core.provider.ProviderKind
import tv.blofy.player.core.provider.ProviderProfile

class ContentUrlResolverTest {
    private val xtreamProfile = ProviderProfile(
        providerKey = "xtream-under-test",
        providerKind = ProviderKind.XTREAM
    )

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
    fun neverRewritesDirectM3uEvenWhenUrlLooksLikeXtream() {
        val m3uProfile = ProviderProfile(
            providerKey = "m3u-under-test",
            providerKind = ProviderKind.M3U
        )
        assertNull(
            ContentUrlResolver.alternateLiveFormat(
                "https://example.com/live/user/pass/100.ts",
                m3uProfile
            )
        )
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
