package tv.blofy.player.ui.catalog

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import tv.blofy.player.data.local.StreamEntity

class SimilarMoviePolicyTest {
    private fun film(id: Int, genre: String? = null, category: String? = null) =
        StreamEntity(
            key = "provider:movie:$id", providerId = "provider", remoteId = "$id",
            categoryId = category, kind = "movie", name = "Film $id", genre = genre
        )

    @Test fun identifiesRealGenreFromDetailsEvenWhenListHasNoGenre() {
        val source = film(1, category = "new")
        val rows = listOf(film(2, "Action"), film(3, "Comedy"), film(4, category = "action"),
            film(5).copy(name = "Action Hero"))
        val categories = mapOf("new" to "New Releases", "action" to "Action")
        assertEquals(listOf("provider:movie:2", "provider:movie:4"),
            SimilarMoviePolicy.rank(source, listOf("Action"), rows, categories).map { it.key })
    }

    @Test fun cachedMovieDetailsCanSupplyGenreMissingFromXtreamList() {
        val source = film(1, "Action")
        val candidates = listOf(film(2), film(3))
        assertEquals(listOf("provider:movie:2"),
            SimilarMoviePolicy.rank(source, emptyList(), candidates, emptyMap(),
                cachedGenres = mapOf("provider:movie:2" to listOf("Action"))).map { it.key })
    }

    @Test fun neverInventsSimilarityFromGenericCategoryOrTitle() {
        assertTrue(SimilarMoviePolicy.rank(film(1, category = "latest"),
            emptyList(), listOf(film(2, category = "latest")),
            mapOf("latest" to "New Releases")).isEmpty())
    }

    @Test fun excludesCurrentFilmAndLockedTitlesAndBoundsResult() {
        val source = film(1, "Horror")
        val rows = listOf(source, film(2, "Horror").copy(locked = true)) +
            (3..40).map { film(it, "Horror") }
        val selected = SimilarMoviePolicy.rank(source, emptyList(), rows, emptyMap(), limit = 500)
        assertEquals(16, selected.size)
        assertTrue(selected.none { it.key == source.key || it.locked })
    }
}
