package tv.blofy.player.core.playback

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import androidx.media3.common.MimeTypes
import org.junit.Test
import tv.blofy.player.core.provider.LiveFormat

class PlaybackMediaTypePolicyTest {
    @Test
    fun hintsExtensionlessHlsLiveUrl() {
        assertTrue(
            PlaybackMediaTypePolicy.shouldHintHls(
                contentKind = "live",
                configuredFormat = LiveFormat.HLS,
                url = "https://example.com/play/channel?id=100"
            )
        )
    }

    @Test
    fun keepsExplicitTsAsTsEvenWhenProviderDefaultIsHls() {
        assertFalse(
            PlaybackMediaTypePolicy.shouldHintHls(
                contentKind = "live",
                configuredFormat = LiveFormat.HLS,
                url = "https://example.com/live/u/p/100.ts"
            )
        )
    }

    @Test
    fun recognizesM3u8AlternateWhenProviderDefaultIsTs() {
        assertTrue(
            PlaybackMediaTypePolicy.shouldHintHls(
                contentKind = "live_preview",
                configuredFormat = LiveFormat.TS,
                url = "https://example.com/live/u/p/100.m3u8?token=ok"
            )
        )
    }

    @Test
    fun doesNotForceNonLiveContentToHls() {
        assertFalse(
            PlaybackMediaTypePolicy.shouldHintHls(
                contentKind = "movie",
                configuredFormat = LiveFormat.HLS,
                url = "https://example.com/movie/100"
            )
        )
    }
    @Test
    fun detectsDashForLiveAndMoviesIncludingQueryStrings() {
        assertEquals(
            MimeTypes.APPLICATION_MPD,
            PlaybackMediaTypePolicy.mimeTypeHint("live", LiveFormat.HLS, "https://cdn.example.test/watch/stream.MPD?token=abc")
        )
        assertEquals(
            MimeTypes.APPLICATION_MPD,
            PlaybackMediaTypePolicy.mimeTypeHint("movie", LiveFormat.TS, "https://cdn.example.test/movies/title.mpd#player")
        )
    }

    @Test
    fun detectsHlsForVodAndDoesNotGuessFromQueryOrHostname() {
        assertEquals(
            MimeTypes.APPLICATION_M3U8,
            PlaybackMediaTypePolicy.mimeTypeHint("movie", LiveFormat.TS, "https://example.test/movies/1.m3u8?token=abc")
        )
        assertNull(PlaybackMediaTypePolicy.mimeTypeHint("movie", LiveFormat.TS, "https://example.test/movie/1?file=clip.mpd"))
        assertNull(PlaybackMediaTypePolicy.mimeTypeHint("movie", LiveFormat.TS, "https://cdn.mpd.example.test/movie/1"))
        assertNull(PlaybackMediaTypePolicy.mimeTypeHint("live", LiveFormat.HLS, "https://example.test/live/stream.mp4"))
    }

    @Test
    fun explicitlyNamedDashOverridesProviderDefaultHls() {
        assertFalse(PlaybackMediaTypePolicy.shouldHintHls("live", LiveFormat.HLS, "https://example.test/ch/stream.mpd"))
    }

}
