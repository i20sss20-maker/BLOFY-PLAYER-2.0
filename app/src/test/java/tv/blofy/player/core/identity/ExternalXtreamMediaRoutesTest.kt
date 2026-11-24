package tv.blofy.player.core.identity

import okhttp3.HttpUrl.Companion.toHttpUrl
import org.junit.Assert.*
import org.junit.Test
import java.io.IOException

class ExternalXtreamMediaRoutesTest {
    private val origin = "https://provider.example.com:8443/".toHttpUrl()
    private val manifest = origin.resolve("live/secret-user/secret-pass/12.m3u8")!!
    @Test fun relativeAbsoluteSegmentsAndKeysAreOpaqueAndReversible() {
        val routes = ExternalXtreamMediaRoutes(origin)
        val root = routes.add(manifest, "m3u8")
        val text = routes.rewriteManifest(manifest, """
            #EXTM3U
            #EXT-X-VERSION:3
            #EXT-X-KEY:METHOD=AES-128,URI="key.bin"
            #EXTINF:4.0,
            segment1.ts
            #EXTINF:4.0,
            https://provider.example.com:8443/live/secret-user/secret-pass/segment2.ts?sig=private
        """.trimIndent())
        assertFalse(text.contains("secret-user"))
        assertFalse(text.contains("secret-pass"))
        assertFalse(text.contains("provider.example.com"))
        assertFalse(text.contains("sig=private"))
        assertEquals(manifest, routes.resolve(root))
        val key = text.lineSequence().first { it.startsWith("#EXT-X-KEY") }.substringAfter("URI=\"").substringBefore('"').toHttpUrl()
        assertEquals(manifest.resolve("key.bin"), routes.resolve(key))
        val segments = text.lineSequence().filter { it.startsWith("https://") }.map { routes.resolve(it.toHttpUrl()) }.toList()
        assertEquals(listOf(manifest.resolve("segment1.ts"), manifest.resolve("segment2.ts?sig=private")), segments)
        assertEquals(text, routes.rewriteManifest(manifest, """
            #EXTM3U
            #EXT-X-VERSION:3
            #EXT-X-KEY:METHOD=AES-128,URI="key.bin"
            #EXTINF:4.0,
            segment1.ts
            #EXTINF:4.0,
            https://provider.example.com:8443/live/secret-user/secret-pass/segment2.ts?sig=private
        """.trimIndent()))
    }

    @Test fun crossOriginAndUnknownOpaqueRoutesAreRejected() {
        val routes = ExternalXtreamMediaRoutes(origin)
        for (child in listOf("https://other.example.com/seg.ts", "http://provider.example.com:8443/seg.ts",
            "https://provider.example.com/seg.ts", "//127.0.0.1/secret", "data:text/plain,secret")) {
            assertThrows(IOException::class.java) { routes.rewriteManifest(manifest, "#EXTM3U\n$child") }
        }
        assertThrows(IOException::class.java) {
            routes.rewriteManifest(manifest, "#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI=\"https://other.example.com/key\"")
        }
        assertThrows(IOException::class.java) { routes.resolve("https://external-xtream.invalid/unknown".toHttpUrl()) }
    }

    @Test fun liveRouteProvidesHlsFallbackButVodDoesNot() {
        val credentials = ExternalStreamConnectClient.Credentials(origin, "user", "pass")
        val live = ExternalStreamConnectCatalog.playback(credentials,
            ExternalStreamConnectCatalog.Item("12", "Live", ExternalStreamConnectCatalog.Kind.LIVE, "ts"))
        assertTrue(live.uri.endsWith(".ts"))
        assertTrue(live.fallbackUri!!.endsWith(".m3u8"))
        assertFalse(live.client.followRedirects)
        val vod = ExternalStreamConnectCatalog.playback(credentials,
            ExternalStreamConnectCatalog.Item("13", "Movie", ExternalStreamConnectCatalog.Kind.MOVIE, "mp4"))
        assertNull(vod.fallbackUri)
    }
}
