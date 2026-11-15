package tv.blofy.player.ui.player

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(manifest = Config.NONE, sdk = [28])
class StreamArabicAudioCatalogTest {
    @Test fun acceptsOnlyFirstPartyAuthenticatedAudioMediaRoutes() {
        val valid = "https://blofyplayer.com/api/v1/stream/media/audio/arabic-feed"
        assertTrue(StreamArabicAudioCatalog.trustedAudioUrl(valid))
        for (bad in listOf(
            "http://blofyplayer.com/api/v1/stream/media/audio/arabic-feed",
            "https://evil.example.com/api/v1/stream/media/audio/feed",
            "https://blofyplayer.com.evil.example.com/api/v1/stream/media/audio/feed",
            "https://user:pass@blofyplayer.com/api/v1/stream/media/audio/feed",
            "https://blofyplayer.com/api/v1/stream/media/video/feed",
            "https://blofyplayer.com:8090/api/v1/stream/media/audio/feed",
            "https://blofyplayer.com/api/v1/stream/media/audio/../video/feed"
        )) assertFalse("Unexpected trusted audio URL: $bad",StreamArabicAudioCatalog.trustedAudioUrl(bad))
    }

    @Test fun invalidUntrustedAndOversizedTracksAreRejected() {
        val payload = """{"tracks":[
          {"id":"ar","label":"Arabic Commentary","playbackUrl":"https://blofyplayer.com/api/v1/stream/media/audio/f1","delaySeconds":4},
          {"id":"ar","label":"Duplicate","playbackUrl":"https://blofyplayer.com/api/v1/stream/media/audio/f2","delaySeconds":2},
          {"id":"no","label":"Untrusted","playbackUrl":"https://untrusted.example.com/a.mp3"},
          {"id":"test","label":"Arabic Feed","playbackUrl":"https://blofyplayer.com/api/v1/stream/media/audio/f3","delaySeconds":999}
        ]}"""
        val tracks = StreamArabicAudioCatalog.decode(payload)
        assertEquals(2, tracks.size)
        assertEquals("ar", tracks[0].id)
        assertEquals(4, tracks[0].initialDelaySeconds)
        assertEquals(30, tracks[1].initialDelaySeconds)
        assertEquals(emptyList<StreamArabicAudioCatalog.Track>(), StreamArabicAudioCatalog.decode("bad json"))
    }
}
