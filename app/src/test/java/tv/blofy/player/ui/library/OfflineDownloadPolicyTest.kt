package tv.blofy.player.ui.library

import org.junit.Assert.*
import org.junit.Test

class OfflineDownloadPolicyTest {
    @Test fun userRequestedDirectProgressiveMoviesAndEpisodesAllowed() {
        assertTrue(OfflineDownloadPolicy.supported("movie","https://blofyplayer.com/api/v1/stream/media/movie/23.mp4","mp4"))
        assertTrue(OfflineDownloadPolicy.supported("episode","https://blofyplayer.com/api/v1/stream/media/series/99.mkv","mkv"))
    }
    @Test fun neverCaptureLiveHlsDrmOrHttpCredentials() {
        assertFalse(OfflineDownloadPolicy.supported("live","https://blofyplayer.com/live/32.mp4","mp4"))
        assertFalse(OfflineDownloadPolicy.supported("movie","https://blofyplayer.com/stream.m3u8","m3u8"))
        assertFalse(OfflineDownloadPolicy.supported("movie","https://blofyplayer.com/movie/32.mpd","mpd"))
        assertFalse(OfflineDownloadPolicy.supported("movie","http://example.com/movie.mp4","mp4"))
        assertFalse(OfflineDownloadPolicy.supported("movie","https://example.com/movie.mp4","mp4",drmProtected=true))
        assertFalse(OfflineDownloadPolicy.supported("movie","https://example.com/live/3.mp4","mp4"))
    }
    @Test fun rejectMalformedExternalSchemesAndSuspiciousExtensions() {
        assertFalse(OfflineDownloadPolicy.supported("movie","file:///tmp/a.mp4","mp4"))
        assertFalse(OfflineDownloadPolicy.supported("movie","https://example.com/a.mp4#fragment","mp4"))
        assertFalse(OfflineDownloadPolicy.supported("movie","https://user:password@example.com/a.mp4","mp4"))
        assertFalse(OfflineDownloadPolicy.supported("movie","https://example.com/a.mp4","ts"))
    }
}
