package tv.blofy.player.data

import kotlinx.coroutines.runBlocking
import okhttp3.HttpUrl.Companion.toHttpUrl
import org.junit.Assert.*
import org.junit.Test

class M3uCatalogParserTest {
    @Test fun parsesGroupedRelativeAndAbsoluteLinks() = runBlocking {
        val items = mutableListOf<M3uCatalogParser.Item>()
        val text = """#EXTM3U
#EXTINF:-1 group-title="News, World",Channel
live/channel.m3u8
#EXTINF:-1 group-title="Movies",Film
https://media.example.com/movie/one.mp4
"""
        val count = M3uCatalogParser.parse(text.reader(), "https://example.com/list.m3u".toHttpUrl()) { items.add(it) }
        assertEquals(2, count)
        assertEquals("News, World", items[0].group)
        assertEquals("https://example.com/live/channel.m3u8", items[0].url)
        assertEquals("movie", items[1].kind)
    }

    @Test fun rejectsHlsAndUnsafeHosts() = runBlocking {
        for (text in listOf("#EXTM3U\n#EXT-X-TARGETDURATION:6\n#EXTINF:6,\nsegment.ts", "#EXTM3U\n#EXTINF:-1,Unsafe\nhttp://127.0.0.1/a.ts")) {
            assertTrue(runCatching { M3uCatalogParser.parse(text.reader(), "https://example.com/list.m3u".toHttpUrl()) {} }.isFailure)
        }
    }
}
