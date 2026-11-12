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
            movie(4), movie(5).copy(kind = "series"))
        val selected = MovieGenrePrefetchPolicy.candidates(
            visible,
            categoryNames = mapOf("new" to "New Releases", "horror" to "Horror Movies"),
            cachedGenres = mapOf("provider:movie:4" to listOf("Action")),
            recentlyAttemptedKeys = emptySet()
        )
        assertEquals(listOf("provider:movie:1"), selected.map { it.key })
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
