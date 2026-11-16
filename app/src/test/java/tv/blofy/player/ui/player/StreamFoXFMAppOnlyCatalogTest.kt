package tv.blofy.player.ui.player

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** Regression: only STREAM exposes locally packaged 33 FoXFM URLs. */
@RunWith(RobolectricTestRunner::class)
@Config(manifest = Config.NONE, sdk = [28])
class StreamFoXFMAppOnlyCatalogTest {
    @Test fun exactlyKnownPublicFoXFMPathsAreAccepted() {
        val ok = listOf(
            "http://foxfm.xyz/1", "http://foxfm.xyz/9",
            "http://foxfm.xyz:8080/live1", "http://foxfm.xyz:8080/live4",
            "http://foxfm.xyz:8080/xtra3", "http://foxfm.xyz:8080/en2",
            "http://foxfm.xyz:8080/fr2", "http://foxfm.xyz:8080/starzplay2",
            "http://foxfm.xyz:8080/shasha2", "http://foxfm.xyz:8080/thmanyah3",
            "http://foxfm.xyz:8080/shahid2", "http://foxfm.xyz:8080/alkass8"
        )
        assertTrue(ok.all { StreamArabicAudioCatalog.appOnlyAudioUrl(it) })
        assertTrue(ok.all { StreamArabicAudioCatalog.playableUrl(it) })
    }

    @Test fun externalAndSpoofedAudioHostsCannotReuseTheAppAllowlist() {
        val denied = listOf(
            "http://radio.anisfm.vip/live/mx/1?token=fake",
            "http://foxfm.xyz.attacker.invalid:8080/live1",
            "http://127.0.0.1:8080/live1",
            "http://foxfm.xyz:8080/1", "http://foxfm.xyz/live1",
            "http://foxfm.xyz:8080/alkass4",
            "http://foxfm.xyz:8080/live5", "http://foxfm.xyz:8080/private",
            "http://foxfm.xyz:8080/live1?token=abc",
            "http://user:password@foxfm.xyz:8080/live1",
            "http://foxfm.xyz:8080/live1#x",
            "https://foxfm.xyz:8080/live1"
        )
        assertTrue(denied.all { !StreamArabicAudioCatalog.appOnlyAudioUrl(it) })
        assertFalse(StreamArabicAudioCatalog.trustedAudioUrl("http://foxfm.xyz:8080/live1"))
    }

    @Test fun blofyLabelsAndGroupedTracksPreserveDirectSourceUrls() {
        val tracks = JSONArray().put(JSONObject()
            .put("id", "blofy-live-1")
            .put("label", "BLOFY Live 1")
            .put("playbackUrl", "http://foxfm.xyz:8080/live1")
            .put("format", "progressive")
        ).put(JSONObject()
            .put("id", "blofy-alkass-8")
            .put("label", "BLOFY Alkass 8")
            .put("playbackUrl", "http://foxfm.xyz:8080/alkass8")
        )
        val parsed = StreamArabicAudioCatalog.decode(JSONObject().put("tracks", tracks).toString())
        assertEquals(2, parsed.size)
        assertEquals("BLOFY Live", StreamArabicAudioCatalog.groupName(parsed[0], true))
        assertEquals("بلوفي الكأس", StreamArabicAudioCatalog.groupName(parsed[1], false))
        assertEquals("http://foxfm.xyz:8080/live1", parsed[0].playbackUrl)
    }
}
