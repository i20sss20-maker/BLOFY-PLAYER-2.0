package tv.blofy.player.core.playback

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
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
    fun hintsDashForLiveAndVodWithSignedUrls() {
        assertTrue(PlaybackMediaTypePolicy.shouldHintDash("https://example.com/channel.MPD?token=123#track"))
        assertTrue(PlaybackMediaTypePolicy.shouldHintDash("https://example.com/movie.mpd"))
    }

    @Test
    fun hintsHlsForExplicitVodManifest() {
        assertTrue(PlaybackMediaTypePolicy.shouldHintHls(
            contentKind = "movie",
            configuredFormat = LiveFormat.TS,
            url = "https://example.com/movie.M3U8?signature=valid"
        ))
    }

    @Test
    fun dashAlwaysOverridesDefaultHlsLiveFormat() {
        assertFalse(PlaybackMediaTypePolicy.shouldHintHls(
            contentKind = "live",
            configuredFormat = LiveFormat.HLS,
            url = "https://example.com/channel.mpd"
        ))
        assertFalse(PlaybackMediaTypePolicy.shouldHintDash("https://example.com/video.ts?manifest=.mpd"))
    }
}
