package tv.blofy.player.data

import com.google.gson.JsonParser
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SeriesEpisodeParserTest {
    @Test
    fun parsesDocumentedSeasonMapAndNormalizesGsonNumbers() {
        val response = mapOf<String, Any?>(
            "episodes" to mapOf(
                "1" to listOf(
                    mapOf(
                        "id" to 7401.0,
                        "season" to 1.0,
                        "episode_num" to 2.0,
                        "title" to "Second",
                        "container_extension" to ".mkv",
                        "info" to mapOf("duration_secs" to 2710.0)
                    )
                )
            )
        )

        val result = SeriesEpisodeParser.parse("provider-a", "series-9", response)

        assertTrue(result.payloadPresent)
        assertEquals(1, result.episodes.size)
        with(result.episodes.single()) {
            assertEquals("7401", remoteId)
            assertEquals(1, season)
            assertEquals(2, episode)
            assertEquals("mkv", extension)
            assertEquals(2710L, durationSecs)
        }
    }

    @Test
    fun parsesFlatListAndAliasFields() {
        val response = mapOf<String, Any?>(
            "result" to mapOf(
                "episodes" to listOf(
                    mapOf(
                        "stream_id" to "88001",
                        "season_number" to "S03",
                        "episode_number" to "4.0",
                        "name" to "Fourth",
                        "extension" to "mp4",
                        "duration" to "00:42:05"
                    )
                )
            )
        )

        val episode = SeriesEpisodeParser.parse("provider-a", "series-9", response).episodes.single()

        assertEquals("88001", episode.remoteId)
        assertEquals(3, episode.season)
        assertEquals(4, episode.episode)
        assertEquals("Fourth", episode.title)
        assertEquals(2525L, episode.durationSecs)
    }

    @Test
    fun parsesIndexedEpisodeMapAndUsesMapKeyAsRemoteIdFallback() {
        val response = mapOf<String, Any?>(
            "data" to mapOf(
                "episodes" to mapOf(
                    "2" to mapOf(
                        "99001" to mapOf(
                            "season" to 2,
                            "episode_num" to 1,
                            "title" to "Season two premiere",
                            "container_extension" to "ts"
                        )
                    )
                )
            )
        )

        val episode = SeriesEpisodeParser.parse("provider-b", "series-4", response).episodes.single()

        assertEquals("99001", episode.remoteId)
        assertEquals(2, episode.season)
        assertEquals(1, episode.episode)
    }

    @Test
    fun parsesKeyedEpisodeWithoutEmbeddedIdOrEpisodeNumber() {
        val response = mapOf<String, Any?>(
            "episodes" to mapOf(
                "4" to mapOf(
                    "77123" to mapOf(
                        "season" to 4,
                        "title" to "Keyed only",
                        "container_extension" to "mkv"
                    )
                )
            )
        )

        val episode = SeriesEpisodeParser.parse("provider-keyed", "series-keyed", response).episodes.single()

        assertEquals("77123", episode.remoteId)
        assertEquals(4, episode.season)
        assertEquals(1, episode.episode)
        assertEquals("mkv", episode.extension)
    }

    @Test
    fun parsesJsonEncodedEpisodesPayload() {
        val response = mapOf<String, Any?>(
            "episodes" to """{"1":[{"episode_id":"501.0","episode":1,"title":"Pilot"}]}"""
        )

        val episode = SeriesEpisodeParser.parse("provider-c", "series-5", response).episodes.single()

        assertEquals("501", episode.remoteId)
        assertEquals(1, episode.season)
        assertEquals(1, episode.episode)
    }

    @Test
    fun parsesTopLevelEpisodeList() {
        val response = listOf(
            mapOf<String, Any?>(
                "episode_id" to "610.0",
                "season" to "2",
                "episode_num" to "7",
                "title" to "Top-level episode",
                "container_extension" to "mkv"
            )
        )

        val result = SeriesEpisodeParser.parse("provider-list", "series-list", response)

        assertTrue(result.payloadPresent)
        with(result.episodes.single()) {
            assertEquals("610", remoteId)
            assertEquals(2, season)
            assertEquals(7, episode)
            assertEquals("mkv", extension)
        }
    }

    @Test
    fun recognizesEmptyTopLevelJsonListAsPresentPayload() {
        val response = JsonParser.parseString("[]")

        val result = SeriesEpisodeParser.parse("provider-empty", "series-empty", response)

        assertTrue(result.payloadPresent)
        assertTrue(result.episodes.isEmpty())
    }

    @Test
    fun distinguishesEmptyEpisodePayloadFromMissingPayload() {
        val empty = SeriesEpisodeParser.parse("provider", "series", mapOf("episodes" to emptyMap<String, Any?>()))
        val missing = SeriesEpisodeParser.parse("provider", "series", mapOf("info" to mapOf("name" to "Show")))

        assertTrue(empty.payloadPresent)
        assertTrue(empty.episodes.isEmpty())
        assertFalse(missing.payloadPresent)
        assertTrue(missing.episodes.isEmpty())
    }

    @Test
    fun repairsLegacyDecimalSeriesIdForRequest() {
        assertEquals("4219", SeriesEpisodeParser.normalizeSeriesIdForRequest("4219.0"))
        assertEquals("004219", SeriesEpisodeParser.normalizeSeriesIdForRequest("004219.000"))
        assertEquals("0014", SeriesEpisodeParser.normalizeSeriesIdForRequest("0014"))
        assertEquals("series-4219", SeriesEpisodeParser.normalizeSeriesIdForRequest("series-4219"))
    }
}
