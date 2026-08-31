package tv.blofy.player.ui.library

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import tv.blofy.player.data.local.EpisodeEntity
import tv.blofy.player.data.local.StreamEntity
import tv.blofy.player.data.local.WatchStateEntity

class ContinueWatchingResolverTest {
    @Test
    fun resolvesEpisodeFromEpisodeTableWithParentSeriesAndResumeState() {
        val state = watch("provider:episode:501", "episode", positionMs = 91_000L)
        val episode = episode(key = state.contentKey, seriesId = "42.0")
        val parent = stream(key = "provider:series:42", remoteId = "42", kind = "series", name = "The Show")

        val resolved = ContinueWatchingResolver.resolve(
            states = listOf(state),
            streamsByKey = emptyMap(),
            episodesByKey = mapOf(episode.key to episode),
            series = listOf(parent)
        )

        val item = resolved.single() as ContinueWatchingEntry.EpisodeEntry
        assertEquals(episode, item.episode)
        assertEquals(parent, item.parentSeries)
        assertEquals(91_000L, item.state.positionMs)
    }

    @Test
    fun keepsLiveAndMovieEntriesInOriginalRecencyOrder() {
        val liveState = watch("provider:live:1", "live", 10_000L)
        val movieState = watch("provider:movie:2", "movie", 20_000L)
        val live = stream(liveState.contentKey, "1", "live", "News")
        val movie = stream(movieState.contentKey, "2", "movie", "Film")

        val resolved = ContinueWatchingResolver.resolve(
            states = listOf(liveState, movieState),
            streamsByKey = mapOf(live.key to live, movie.key to movie),
            episodesByKey = emptyMap(),
            series = emptyList()
        )

        assertEquals(listOf(live, movie), resolved.map { (it as ContinueWatchingEntry.StreamEntry).stream })
    }

    @Test
    fun fallsBackToEpisodePrimaryKeyForLegacyKindAndAllowsMissingParent() {
        val state = watch("provider:episode:777", "series", 30_000L)
        val episode = episode(state.contentKey, "missing-series")

        val resolved = ContinueWatchingResolver.resolve(
            states = listOf(state),
            streamsByKey = emptyMap(),
            episodesByKey = mapOf(episode.key to episode),
            series = emptyList()
        )

        val item = resolved.single() as ContinueWatchingEntry.EpisodeEntry
        assertEquals(episode, item.episode)
        assertNull(item.parentSeries)
    }

    @Test
    fun ignoresMissingOrCrossProviderRows() {
        val state = watch("provider:episode:501", "episode", 5_000L)
        val wrongProvider = episode(state.contentKey, "42").copy(providerId = "other")

        val resolved = ContinueWatchingResolver.resolve(
            states = listOf(state),
            streamsByKey = emptyMap(),
            episodesByKey = mapOf(wrongProvider.key to wrongProvider),
            series = emptyList()
        )

        assertTrue(resolved.isEmpty())
    }

    private fun watch(key: String, kind: String, positionMs: Long) = WatchStateEntity(
        contentKey = key,
        providerId = "provider",
        kind = kind,
        positionMs = positionMs,
        durationMs = 300_000L
    )

    private fun episode(key: String, seriesId: String) = EpisodeEntity(
        key = key,
        providerId = "provider",
        seriesId = seriesId,
        remoteId = key.substringAfterLast(':'),
        season = 1,
        episode = 2,
        title = "Second"
    )

    private fun stream(key: String, remoteId: String, kind: String, name: String) = StreamEntity(
        key = key,
        providerId = "provider",
        remoteId = remoteId,
        categoryId = null,
        kind = kind,
        name = name
    )
}
