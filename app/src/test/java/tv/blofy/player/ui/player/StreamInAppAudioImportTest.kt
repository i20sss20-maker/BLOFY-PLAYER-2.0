package tv.blofy.player.ui.player

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(manifest = Config.NONE, sdk = [28])
class StreamInAppAudioImportTest {
    @Test fun m3uAudioIsUsableButVideoIsExcluded() {
        val content = """
            #EXTM3U
            #EXTINF:-1 tvg-name="التعليق العربي",Channel
            https://audio.example.org/live/ar.mp3
            #EXTINF:-1,English Commentary
            https://audio.example.org/live/en.m3u8
            #EXTINF:-1,Video
            https://video.example.org/live/stream.ts
        """.trimIndent()
        val tracks = StreamInAppAudioImport.parse("voices.m3u", content).tracks
        assertEquals(2, tracks.size)
        assertEquals("التعليق العربي", tracks[0].label)
        assertEquals("progressive", tracks[0].format)
        assertEquals("hls", tracks[1].format)
    }

    @Test fun anHlsManifestContainsSegmentsNotIndependentAudioSources() {
        val playlist = "#EXTM3U\n#EXT-X-TARGETDURATION:6\n#EXTINF:6\nhttps://cdn.example.org/seg0001.aac"
        val preview = StreamInAppAudioImport.parse("media.m3u8", playlist)
        assertTrue(preview.tracks.isEmpty())
        assertEquals("manifest_not_a_source_url", preview.note)
    }

    @Test fun supportsTextAndCfgWithoutTreatingPasswordsAsAudio() {
        val config = """
            username=test
            password=do-not-import
            url = https://audio.example.org/live/arabic.aac
            https://audio.example.org/live/commentary.ogg
        """.trimIndent()
        assertEquals(2, StreamInAppAudioImport.parse("playlist.txt", config).tracks.size)
        assertEquals(2, StreamInAppAudioImport.parse("playlist.cfg", config).tracks.size)
    }

    @Test fun nestedJsonAndXmlAudioUrlsAreParsedSafely() {
        val json = """{"channels":[{"label":"Arabic","sources":[
          {"name":"Commentary","audioUrl":"https://audio.example.org/a.mp3","delaySeconds":5}
        ]}]}"""
        val entries = StreamInAppAudioImport.parse("tracks.json", json).tracks
        assertEquals(1, entries.size)
        assertEquals("Commentary", entries.first().label)
        assertEquals(5, entries.first().initialDelaySeconds)

        val xml = """<root><audio name="صوت عربي" url="https://audio.example.org/live/ar.aac"/>
          <stream title="تعليق" src="https://audio.example.org/live/ar2.mp3"/></root>"""
        val parsed = StreamInAppAudioImport.parse("tracks.xml", xml).tracks
        assertEquals(2, parsed.size)
        assertEquals("صوت عربي", parsed.first().label)
    }

    @Test fun rejectsDangerousUrlsUnsupportedFormatsAndOversizedLists() {
        val list = """
            http://audio.example.org/insecure.mp3
            https://user:pass@audio.example.org/secret.mp3
            https://192.168.0.2/private.mp3
            file:///sdcard/voice.mp3
        """.trimIndent()
        assertEquals(0, StreamInAppAudioImport.parse("audios.m3u", list).tracks.size)
        assertEquals("unsupported", StreamInAppAudioImport.parse("file.exe", list).note)
        assertEquals("too_large", StreamInAppAudioImport.parse("file.txt", "x".repeat(262_145)).note)
        val xmlWithEntities = """<!DOCTYPE root [<!ENTITY data SYSTEM "file:///etc/passwd">]><root><audio>&data;</audio></root>"""
        assertEquals(0, StreamInAppAudioImport.parse("file.xml", xmlWithEntities).tracks.size)
    }
}
