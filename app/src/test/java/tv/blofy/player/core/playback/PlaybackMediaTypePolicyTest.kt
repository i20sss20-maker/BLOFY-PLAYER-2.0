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
}
