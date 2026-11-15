package tv.blofy.player.ui.player

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.json.JSONArray
import org.json.JSONObject

@RunWith(RobolectricTestRunner::class)
@Config(manifest = Config.NONE, sdk = [28])
class StreamAnisAudioCatalogTest {
    @Test fun all38AudioTracksFitInInternalStreamingMenu() {
        val tracks = JSONArray()
        val names = (1..6).map { "anis-max-$it" } +
            (1..9).map { "anis-sport-$it" } +
            (1..2).map { "anis-italy-$it" } +
            (1..2).map { "anis-de-$it" } +
            (1..3).map { "anis-thm8h-$it" } +
            listOf("anis-shasha", "anis-shahid") +
            (1..2).map { "anis-en-$it" } +
            (1..2).map { "anis-fr-$it" } +
            (1..2).map { "anis-xtra-$it" } +
            (1..2).map { "anis-alkass-$it" } +
            (1..6).map { "anis-max-low-$it" }
        assertEquals(38, names.size)
        for (id in names) tracks.put(JSONObject().apply {
            put("id", id)
            put("label", id)
            put("delaySeconds", 0)
            put("playbackUrl", "https://blofyplayer.com/api/v1/stream/media/audio/$id")
            put("format", "progressive")
        })
        val decoded = StreamArabicAudioCatalog.decode(
            JSONObject().put("tracks", tracks).toString())
        assertEquals(38, decoded.size)
        assertEquals(12, decoded.map {
            StreamArabicAudioCatalog.groupName(it, false)
        }.distinct().size)
        assertEquals("أنيس سبورت",
            StreamArabicAudioCatalog.groupName(
                decoded.first { it.id == "anis-sport-9" }, false))
        assertEquals("Anis Max Low",
            StreamArabicAudioCatalog.groupName(
                decoded.first { it.id == "anis-max-low-6" }, true))
    }

    @Test fun neverAllowExternalOriginForCodeProtectedAudio() {
        val firstParty =
            "https://blofyplayer.com/api/v1/stream/media/audio/anis-max-1"
        assertTrue(StreamArabicAudioCatalog.trustedAudioUrl(firstParty))
        val fakeProvider = "http://radio.anisfm.vip/live/mx/1?token=example"
        assertFalse(StreamArabicAudioCatalog.trustedAudioUrl(fakeProvider))
        val hostSpoof = "https://blofyplayer.com.evil.example/api/v1/stream/media/audio/anis-max-1"
        assertFalse(StreamArabicAudioCatalog.trustedAudioUrl(hostSpoof))
    }
}
