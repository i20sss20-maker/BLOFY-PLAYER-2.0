package tv.blofy.player.ui.home

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import tv.blofy.player.data.local.StreamEntity

class SmartHomeEngineTest {
    private fun movie(
        id: Int, genre: String? = null, category: String? = null,
        rating: String? = null, kind: String = "movie",
        locked: Boolean = false
    ) = StreamEntity(
        key = "p:$kind:$id", providerId = "p", remoteId = "$id",
        categoryId = category, kind = kind, name = "Title $id",
        genre = genre, rating = rating, locked = locked,
        addedAt = id.toLong()
    )

    @Test fun recommendationsPrioritizeWatchedGenresWithoutRecommendingAlreadyWatched() {
        val watched = listOf(movie(1, "Action"), movie(2, "Action, Adventure"))
        val candidates = listOf(movie(1, "Action"), movie(3, "Drama", rating = "9.0"),
            movie(4, "Action", rating = "7.1"), movie(5, "Action", locked = true))
        val suggested = SmartHomeEngine.recommend(watched, candidates)
        assertEquals("p:movie:4", suggested.first().key)
        assertFalse(suggested.any { it.key == "p:movie:1" || it.locked })
    }

    @Test fun recommendationsAreBoundedAndSkipContinuingItems() {
        val all = (1..50).map { movie(it, rating = "6.3") }
        val suggestions = SmartHomeEngine.recommend(
            emptyList(), all, continuing = listOf(all.first()), limit = 200)
        assertEquals(24, suggestions.size)
        assertFalse(suggestions.contains(all.first()))
        assertEquals(suggestions.distinctBy { it.key }, suggestions)
    }

    @Test fun genreShelvesUseSourceMetadataRatherThanMovieTitle() {
        val data = listOf(
            movie(1, "Comedy"),
            movie(2, "Action / Thriller"),
            movie(3, category = "horror"),
            movie(4).copy(name = "Action Movie Name"),
            movie(5, "Action", locked = true)
        )
        val names = mapOf("horror" to "Horror Movies")
        assertEquals(listOf("p:movie:2"),
            SmartHomeEngine.byGenre(data, names, "action").map { it.key })
        assertEquals(listOf("p:movie:3"),
            SmartHomeEngine.byGenre(data, names, "horror").map { it.key })
        assertEquals(listOf("p:movie:1"),
            SmartHomeEngine.byGenre(data, names, "comedy").map { it.key })
        assertTrue(SmartHomeEngine.byGenre(data, names, "scifi").isEmpty())
    }

    @Test fun kindPreferenceFollowsPlaybackHistory() {
        val watched = listOf(movie(1, kind = "series"), movie(2, kind = "series"),
            movie(3, kind = "movie"))
        assertEquals("series", SmartHomeEngine.preferredKind(watched))
        assertEquals("movie", SmartHomeEngine.preferredKind(emptyList()))
    }
}
