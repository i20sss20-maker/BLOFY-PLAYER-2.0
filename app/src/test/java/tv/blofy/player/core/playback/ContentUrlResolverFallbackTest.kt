package tv.blofy.player.core.playback

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import tv.blofy.player.data.local.StreamEntity

class ContentUrlResolverFallbackTest {
    @Test
    fun context_free_fallback_rejects_private_host() {
        val stream = stream("http://192.168.1.20:8080/live/u/p/1.ts")
        assertNull(ContentUrlResolver.directFallback(stream))
    }

    @Test
    fun context_free_fallback_preserves_public_host() {
        val url = "https://cdn.example.net/vod/1.mp4?token=x"
        assertEquals(url, ContentUrlResolver.directFallback(stream(url)))
    }

    private fun stream(url: String) = StreamEntity(
        key = "provider:movie:1",
        providerId = "provider",
        remoteId = "1",
        categoryId = "movies",
        kind = "movie",
        name = "Movie",
        directSource = url,
    )
}
