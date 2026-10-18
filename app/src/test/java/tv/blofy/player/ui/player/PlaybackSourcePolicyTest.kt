package tv.blofy.player.ui.player

import org.junit.Assert.assertEquals
import org.junit.Test

class PlaybackSourcePolicyTest {
    @Test
    fun oneSourceWhenProviderHasNoBackup() {
        val urls = PlaybackSourcePolicy.availableSources("https://example.test/live/1.m3u8", null)
        assertEquals(listOf("https://example.test/live/1.m3u8"), urls.map { it.url })
    }

    @Test
    fun twoDistinctProviderConfiguredSourcesAreAvailable() {
        val urls = PlaybackSourcePolicy.availableSources(
            "https://example.test/live/1.m3u8",
            " https://backup.example.test/live/1.m3u8 "
        )
        assertEquals(
            listOf("https://example.test/live/1.m3u8", "https://backup.example.test/live/1.m3u8"),
            urls.map { it.url }
        )
    }

    @Test
    fun duplicateFallbackIsOmitted() {
        val urls = PlaybackSourcePolicy.availableSources(
            "https://example.test/live/1.ts",
            "HTTPS://EXAMPLE.TEST/live/1.ts"
        )
        assertEquals(1, urls.size)
    }

    @Test
    fun nonNetworkBackupIsNotOffered() {
        for (url in listOf("file:///tmp/video.mp4", "content://local/video", "javascript:alert(1)")) {
            assertEquals(1, PlaybackSourcePolicy.availableSources("https://example.test/vod/1.mp4", url).size)
        }
    }
}
