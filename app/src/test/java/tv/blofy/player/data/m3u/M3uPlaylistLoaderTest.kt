package tv.blofy.player.data.m3u

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import tv.blofy.player.data.local.ProviderEntity

class M3uPlaylistLoaderTest {
    private val provider = ProviderEntity(
        id = "p1",
        name = "M3U Test",
        baseUrl = "https://example.com/list.m3u",
        username = "",
        password = "",
        providerType = "m3u"
    )

    @Test
    fun parsesLiveMovieAndSeriesWithoutRewritingDirectUrls() {
        val text = """
            #EXTM3U
            #EXTINF:-1 tvg-id="news.sa" tvg-logo="https://img/live.png" group-title="News",Saudi News
            https://cdn.example.com/live/channel.m3u8
            #EXTINF:-1 group-title="Movies",Movie One
            https://cdn.example.com/vod/movie-one.mp4
            #EXTINF:-1 group-title="Series" tvg-logo="https://img/show.png",My Show S01E02 Episode Two
            https://cdn.example.com/series/show-s01e02.mkv
            #EXTINF:-1 group-title="Series",My Show S01E01 Episode One
            https://cdn.example.com/series/show-s01e01.mkv
        """.trimIndent()

        val parsed = M3uPlaylistLoader().parse(provider, text)

        val live = parsed.streams.single { it.kind == "live" }
        assertEquals("Saudi News", live.name)
        assertEquals("news.sa", live.epgChannelId)
        assertEquals("https://cdn.example.com/live/channel.m3u8", live.directSource)
        assertEquals("m3u", live.streamType)

        val movie = parsed.streams.single { it.kind == "movie" }
        assertEquals("Movie One", movie.name)
        assertEquals("mp4", movie.extension)
        assertEquals("https://cdn.example.com/vod/movie-one.mp4", movie.directSource)

        val series = parsed.streams.single { it.kind == "series" }
        assertEquals("My Show", series.name)
        assertEquals("m3u-series", series.streamType)

        assertEquals(2, parsed.episodes.size)
        assertEquals(listOf(1, 2), parsed.episodes.map { it.episode })
        assertEquals(listOf(1, 1), parsed.episodes.map { it.season })
        assertTrue(parsed.episodes.all { it.directSource?.startsWith("https://cdn.example.com/series/") == true })
    }

    @Test
    fun movieGroupOverridesStreamLikeExtensionAndBrokenMetadataDoesNotBlockFollowingEntries() {
        val text = """
            #EXTM3U
            #EXTINF:-1 group-title="Movies",HLS Movie
            https://cdn.example.com/vod/movie/master.m3u8
            #BROKEN SOMETHING
            #EXTINF:-1 group-title="General",Channel Two
            https://cdn.example.com/live/two.ts
        """.trimIndent()

        val parsed = M3uPlaylistLoader().parse(provider, text)

        assertEquals(2, parsed.streams.size)
        assertNotNull(parsed.streams.firstOrNull { it.kind == "movie" && it.name == "HLS Movie" })
        assertNotNull(parsed.streams.firstOrNull { it.kind == "live" && it.name == "Channel Two" })
    }

    @Test
    fun createsDistinctCategoriesPerKindEvenWhenNamesMatch() {
        val text = """
            #EXTM3U
            #EXTINF:-1 group-title="Featured",Live Featured
            https://cdn.example.com/live/featured.ts
            #EXTINF:-1 group-title="Featured",Movie Featured
            https://cdn.example.com/movie/featured.mp4
        """.trimIndent()

        val parsed = M3uPlaylistLoader().parse(provider, text)

        assertEquals(2, parsed.categories.count { it.name == "Featured" })
        assertEquals(setOf("live", "movie"), parsed.categories.filter { it.name == "Featured" }.map { it.kind }.toSet())
    }
}
