package tv.blofy.player.core.playback

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class PlaybackFallbackPolicyTest {
    @Test fun exhaustsDistinctRoutesInOrderAndResetsForNextChannel() {
        val state = PlaybackFallbackState()
        val primary = "https://hidden.example/a.ts"
        val origin = "https://panel.example/a.ts"
        val canonical = "https://panel.example/live/u/p/1.ts"
        val hls = "https://panel.example/live/u/p/1.m3u8"
        state.begin(primary, canonical, listOf(primary, origin, origin, "file:///bad", canonical, hls))
        for (url in listOf(origin, canonical, hls)) {
            assertEquals(url, state.nextConfiguredUrl())
            state.markConfiguredUrlAttempted(url)
        }
        assertNull(state.nextConfiguredUrl())
        state.begin("https://panel.example/live/u/p/2.ts", null)
        assertNull(state.nextConfiguredUrl())
    }

    @Test
    fun returnsUnusedHttpFallback() {
        assertEquals(
            "http://cdn.example.com/direct/100.ts",
            PlaybackFallbackPolicy.configuredUrl(
                fallbackUrl = "http://cdn.example.com/direct/100.ts",
                fallbackAttempted = false,
                attemptedUrls = setOf("http://example.com/live/u/p/100.ts")
            )
        )
    }

    @Test
    fun preventsFallbackLoopToAlreadyAttemptedUrl() {
        val url = "https://example.com/live/u/p/100.ts"
        assertNull(
            PlaybackFallbackPolicy.configuredUrl(
                fallbackUrl = url,
                fallbackAttempted = false,
                attemptedUrls = setOf(url)
            )
        )
    }

    @Test
    fun onlyAttemptsConfiguredFallbackOnce() {
        assertNull(
            PlaybackFallbackPolicy.configuredUrl(
                fallbackUrl = "https://cdn.example.com/direct/100.m3u8",
                fallbackAttempted = true,
                attemptedUrls = emptySet()
            )
        )
    }

    @Test
    fun rejectsNonHttpFallback() {
        assertNull(
            PlaybackFallbackPolicy.configuredUrl(
                fallbackUrl = "file:///storage/100.ts",
                fallbackAttempted = false,
                attemptedUrls = emptySet()
            )
        )
    }

    @Test
    fun beginningNewPlaybackClearsPreviousContentFallback() {
        val state = PlaybackFallbackState()
        state.begin(
            primaryUrl = "https://example.com/live/u/p/100.ts",
            fallbackUrl = "https://cdn.example.com/direct/100.ts"
        )
        assertEquals("https://cdn.example.com/direct/100.ts", state.nextConfiguredUrl())

        state.begin(
            primaryUrl = "https://example.com/live/u/p/200.ts",
            fallbackUrl = null
        )
        assertNull(state.nextConfiguredUrl())
    }

    @Test
    fun silentStallConsumesConfiguredFallbackOnlyOnce() {
        val primary = "http://hidden.example.net:9090/live/u/p/100.ts"
        val fallback = "http://panel.example.com:8080/live/u/p/100.ts"
        val state = PlaybackFallbackState()
        state.begin(primaryUrl = primary, fallbackUrl = fallback)

        assertEquals(fallback, state.nextConfiguredUrl())
        state.markConfiguredUrlAttempted(fallback)
        assertNull(state.nextConfiguredUrl())
    }
}
