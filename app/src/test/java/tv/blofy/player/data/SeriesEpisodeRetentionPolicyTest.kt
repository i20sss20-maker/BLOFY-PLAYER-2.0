package tv.blofy.player.data

import org.junit.Assert.*
import org.junit.Test
import tv.blofy.player.data.local.EpisodeEntity

class SeriesEpisodeRetentionPolicyTest {
    private fun e(id: String, number: Int, title: String = id) = EpisodeEntity(
        key = "source:episode:$id", providerId = "source", seriesId = "show",
        remoteId = id, season = 1, episode = number, title = title
    )

    @Test fun newlyAiredEpisodesAreAddedWithoutDeletingPreviouslyCachedEpisodes() {
        val saved = listOf(e("1", 1), e("2", 2))
        val response = listOf(e("2", 2), e("3", 3))
        val result = SeriesEpisodeRetentionPolicy.preserveCached(saved, response)
        assertEquals(setOf("1", "2", "3"), result.map { it.remoteId }.toSet())
        assertEquals(3, result.size)
    }

    @Test fun fullUpdatedResponseReplacesEpisodeMetadataWithoutDuplicatingEntries() {
        val saved = listOf(e("1", 1, "Old title"))
        val updated = listOf(e("1", 1, "New title"))
        val result = SeriesEpisodeRetentionPolicy.preserveCached(saved, updated)
        assertEquals(1, result.size)
        assertEquals("New title", result.single().title)
    }

    @Test fun emptyOrInterruptedResponseKeepsAllKnownEpisodes() {
        val saved = listOf(e("1", 1), e("2", 2))
        assertEquals(saved, SeriesEpisodeRetentionPolicy.preserveCached(saved, emptyList()))
    }
}
