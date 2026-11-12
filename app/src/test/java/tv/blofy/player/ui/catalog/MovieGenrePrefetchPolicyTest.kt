package tv.blofy.player.ui.catalog

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import tv.blofy.player.data.local.StreamEntity

class MovieGenrePrefetchPolicyTest {
    private fun movie(index: Int, category: String = "new", genre: String? = null) =
        StreamEntity(key = "provider:movie:$index", providerId = "provider",
            remoteId = "$index", categoryId = category, kind = "movie",
            name = "Film $index", genre = genre)

    @Test fun loadsOnlyVisibleMoviesThatStillHaveNoTrustworthyGenre() {
        val visible = listOf(movie(1), movie(2, "horror"), movie(3, genre = "Comedy"),
            movie(4), movie(5).copy(key = "provider:series:5", kind = "series", genre = "Drama"))
        val selected = MovieGenrePrefetchPolicy.candidates(
            visible,
            categoryNames = mapOf("new" to "New Releases", "horror" to "Horror Movies"),
            cachedGenres = mapOf("provider:movie:4" to listOf("Action")),
            recentlyAttemptedKeys = emptySet()
        )
        assertEquals(listOf("provider:movie:1"), selected.map { it.key })
    }

    @Test fun prefetchesVisibleSeriesOnlyWhenProviderGenreIsUnknown() {
        val series = listOf(
            movie(1).copy(key = "provider:series:1", kind = "series"),
            movie(2).copy(key = "provider:series:2", kind = "series", genre = "Action"),
            movie(3).copy(key = "provider:series:3", kind = "series"),
            movie(4).copy(key = "provider:series:4", kind = "series", remoteId = "")
        )
        val selected = MovieGenrePrefetchPolicy.candidates(
            series, mapOf("new" to "New Series"), emptyMap(),
            setOf("provider:series:3")
        )
        assertEquals(listOf("provider:series:1"), selected.map { it.key })
    }

    @Test fun skipsRecentFailuresAndBoundsRequestsForLargeCatalogs() {
        val visible = (1..40).map { movie(it) }
        val selected = MovieGenrePrefetchPolicy.candidates(
            visible, mapOf("new" to "4K New Releases"), emptyMap(),
            setOf("provider:movie:1"), 100
        )
        assertEquals(12, selected.size)
        assertTrue(selected.none { it.remoteId == "1" })
    }

    @Test fun missingRemoteIdCannotTriggerInvalidMetadataRequest() {
        assertTrue(MovieGenrePrefetchPolicy.candidates(
            listOf(movie(1).copy(remoteId = "")), emptyMap(), emptyMap(), emptySet()
        ).isEmpty())
    }
}
