package tv.blofy.player.core.playback

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class PlaybackFallbackPolicyTest {
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
}
