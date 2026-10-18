package tv.blofy.player.core.url

import org.junit.Assert.assertEquals
import org.junit.Test
import tv.blofy.player.core.provider.LiveFormat

class XtreamUrlBuilderTest {
    @Test
    fun buildsLiveTsExactly() {
        assertEquals(
            "http://example.com/live/user/pass/100.ts",
            XtreamUrlBuilder.live("http://example.com/", "user", "pass", "100", LiveFormat.TS)
        )
    }

    @Test
    fun buildsLiveHlsExactly() {
        assertEquals(
            "https://example.com/live/user/pass/100.m3u8",
            XtreamUrlBuilder.live("https://example.com", "user", "pass", "100", LiveFormat.HLS)
        )
    }

    @Test
    fun buildsMovieWithProviderExtension() {
        assertEquals(
            "https://example.com/movie/user/pass/44.mkv",
            XtreamUrlBuilder.movie("https://example.com", "user", "pass", "44", ".mkv")
        )
    }

    @Test
    fun percentEncodesSpecialCharactersInCredentialsAndStreamIds() {
        assertEquals(
            "https://example.com/movie/a%3Fb/p%23%20%26/hello%2Fworld.mkv",
            XtreamUrlBuilder.movie("https://example.com", "a?b", "p# &", "hello/world", ".mkv")
        )
    }

    @Test
    fun invalidMediaExtensionDoesNotInjectQueryIntoPlaybackUrl() {
        assertEquals(
            "https://example.com/series/user/pass/55.mp4",
            XtreamUrlBuilder.episode("https://example.com", "user", "pass", "55", "mp4?bad=1")
        )
    }

    @Test
    fun buildsEpisodeWithProviderExtension() {
        assertEquals(
            "https://example.com/series/user/pass/55.mp4",
            XtreamUrlBuilder.episode("https://example.com", "user", "pass", "55", "mp4")
        )
    }
}
