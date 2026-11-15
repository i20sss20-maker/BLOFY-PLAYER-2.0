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

    @Test fun packagedInAppChannelsAreVisibleWithoutServerAndSeparatedPerChannel() {
        val catalog = """{"channels":[
          {"channelId":"123","tracks":[
            {"id":"ar-1","label":"تعليق عربي","playbackUrl":"https://commentary.example.org/live.m3u8","delaySeconds":3}
          ]},
          {"channelId":"456","tracks":[
            {"id":"ar-2","label":"Arabic 2","playbackUrl":"https://blofyplayer.com/api/v1/stream/media/audio/other","delaySeconds":1}
          ]}
        ]}"""
        val first = StreamArabicAudioCatalog.decodeForChannel(catalog, "123")
        assertEquals(1, first.size)
        assertEquals("تعليق عربي", first[0].label)
        assertEquals(3, first[0].initialDelaySeconds)
        assertEquals("hls", first[0].format)
        assertEquals(1, StreamArabicAudioCatalog.decodeForChannel(catalog, "456").size)
        assertEquals(0, StreamArabicAudioCatalog.decodeForChannel(catalog, "999").size)
        assertEquals(0, StreamArabicAudioCatalog.decodeForChannel(catalog, "../../").size)
    }

    @Test fun publicAudioSourcesNeverCountAsTrustedBearerDestinations() {
        assertTrue(StreamArabicAudioCatalog.publicAudioUrl("https://audio.example.org/ar.mp3"))
        assertFalse(StreamArabicAudioCatalog.trustedAudioUrl("https://audio.example.org/ar.mp3"))
        for (bad in listOf(
            "http://audio.example.org/ar.mp3",
            "https://user:pw@audio.example.org/ar.mp3",
            "https://audio.example.org:8090/ar.mp3",
            "https://localhost/ar.mp3",
            "https://192.168.1.23/ar.mp3",
            "https://audio.example.org/ar.mp3#foo",
            "https://audio.example.org.evil.test/a .mp3"
        )) assertFalse(StreamArabicAudioCatalog.publicAudioUrl(bad))
    }

    @Test fun invalidUntrustedAndOversizedTracksAreRejected() {
        val payload = """{"tracks":[
          {"id":"ar","label":"Arabic Commentary","playbackUrl":"https://blofyplayer.com/api/v1/stream/media/audio/f1","delaySeconds":4,"format":"hls"},
          {"id":"ar","label":"Duplicate","playbackUrl":"https://blofyplayer.com/api/v1/stream/media/audio/f2","delaySeconds":2},
          {"id":"no","label":"Insecure","playbackUrl":"http://untrusted.example.com/a.mp3"},
          {"id":"test","label":"Arabic Feed","playbackUrl":"https://blofyplayer.com/api/v1/stream/media/audio/f3","delaySeconds":999}
        ]}"""
        val tracks = StreamArabicAudioCatalog.decode(payload)
        assertEquals(2, tracks.size)
        assertEquals("ar", tracks[0].id)
        assertEquals(4, tracks[0].initialDelaySeconds)
        assertEquals("hls",tracks[0].format)
        assertEquals("progressive",tracks[1].format)
        assertEquals(30, tracks[1].initialDelaySeconds)
        assertEquals(emptyList<StreamArabicAudioCatalog.Track>(), StreamArabicAudioCatalog.decode("bad json"))
    }
}
