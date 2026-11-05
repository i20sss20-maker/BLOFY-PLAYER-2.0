package tv.blofy.player.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class M3uOriginalOrderTest {
    @Test fun originalM3uSequenceIsUsedNotNamesOrNumericIds() {
        val parser = M3uOriginalOrder()
        listOf(
            "#EXTM3U",
            """#EXTINF:-1 tvg-name="Zulu" group-title="Sports",Zulu""",
            "http://server.test/live/username/password/99.ts",
            """#EXTINF:-1 tvg-name="Alpha" group-title="News",Alpha""",
            "http://server.test/live/username/password/2.m3u8",
            """#EXTINF:-1 group-title="Sports",Bravo""",
            "http://server.test/live/username/password/8.ts",
            """#EXTINF:-1 group-title="Movies",Movie B""",
            "http://server.test/movie/username/password/17.mp4",
            """#EXTINF:-1 group-title="Movies",Movie A""",
            "http://server.test/movie/username/password/5.mkv"
        ).forEach(parser::accept)
        assertTrue(parser.validHeader)
        assertEquals(listOf("99", "2", "8"), parser.live.keys.toList())
        assertEquals(listOf(1L, 2L, 3L), parser.live.values.toList())
        assertEquals(listOf("sports", "news"), parser.liveGroups.keys.toList())
        assertEquals(listOf("17", "5"), parser.movie.keys.toList())
    }

    @Test fun legacyThreeSegmentLiveUrlIsRecognized() {
        val parser = M3uOriginalOrder()
        listOf("#EXTM3U", """#EXTINF:-1 group-title="Local",Channel""",
            "http://provider.example:80/demo/password/00019.ts").forEach(parser::accept)
        assertEquals(listOf("19"), parser.live.keys.toList())
        assertEquals(listOf("local"), parser.liveGroups.keys.toList())
    }

    @Test fun seriesEpisodesNeverMislabelledAsSeriesIdentifiers() {
        val parser = M3uOriginalOrder()
        listOf("#EXTM3U", """#EXTINF:-1 group-title="Series",Show S01E01""",
            "http://host/series/demo/secret/300.mp4").forEach(parser::accept)
        assertTrue(parser.live.isEmpty())
        assertTrue(parser.movie.isEmpty())
    }

    @Test(expected = IllegalArgumentException::class)
    fun refusesHtmlLoginPageInsteadOfAccidentallyOverwritingChannels() {
        M3uOriginalOrder().accept("<!DOCTYPE html>")
    }

    @Test fun invalidUnmatchedLinesNeverAffectOrder() {
        val parser = M3uOriginalOrder()
        listOf("#EXTM3U", "#EXTINF:-1,Invalid", "not a media url", "   ",
            """#EXTINF:-1 group-title="Sports", Valid""",
            "http://server.test/live/u/p/0007.ts").forEach(parser::accept)
        assertEquals(listOf("7"), parser.live.keys.toList())
        assertFalse(parser.liveGroups.isEmpty())
    }
}
