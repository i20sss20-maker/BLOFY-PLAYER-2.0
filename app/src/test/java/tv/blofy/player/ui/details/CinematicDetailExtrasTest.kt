package tv.blofy.player.ui.details

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import tv.blofy.player.data.local.StreamEntity

class CinematicDetailExtrasTest {
    private fun movie(id: String, genre: String?, kind: String = "movie", locked: Boolean = false) =
        StreamEntity(
            key = id, providerId = "test-provider", remoteId = id,
            categoryId = null, kind = kind, name = id, genre = genre, locked = locked
        )

    @Test fun recommendsOnlyRelatedUnlockedSameKind() {
        val current = movie("one", "Action, Science Fiction")
        val candidates = listOf(
            current, movie("two", "Drama, Action"), movie("three", "Comedy"),
            movie("four", "Action", locked = true), movie("five", "Action", kind = "series")
        )
        assertEquals(listOf("two"), CinematicDetailExtras.relatedItems(current, candidates).map { it.key })
    }

    @Test fun doesNotInventRelatedContentWithoutGenreMetadata() {
        assertTrue(CinematicDetailExtras.relatedItems(movie("one", null), listOf(movie("two", "Action"))).isEmpty())
    }
}
