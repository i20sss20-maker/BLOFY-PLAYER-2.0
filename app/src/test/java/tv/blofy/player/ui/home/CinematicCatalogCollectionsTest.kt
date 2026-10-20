package tv.blofy.player.ui.home

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import tv.blofy.player.data.local.StreamEntity

class CinematicCatalogCollectionsTest {
    private fun stream(
        id: String, name: String, genre: String? = null, locked: Boolean = false
    ) = StreamEntity(
        key = id, providerId = "test-provider", remoteId = id,
        categoryId = null, kind = "movie", name = name, genre = genre, locked = locked
    )

    @Test fun createsUniverseOnlyFromActualUnlockedTitles() {
        val items = listOf(
            stream("1", "Batman Begins"),
            stream("2", "The Batman"),
            stream("3", "Harry Potter"),
            stream("4", "Batman Forever", locked = true)
        )
        val rows = CinematicCatalogCollections.from(items)
        assertEquals(listOf("عالم Batman"), rows.map { it.title })
        assertEquals(listOf("1", "2"), rows.single().entries.map { it.key })
    }

    @Test fun genreRailsOnlyAppearWithEnoughCatalogTitles() {
        val items = (1..4).map { stream("$it", "Film $it", "Action, Drama") }
        assertEquals("أفلام الأكشن", CinematicCatalogCollections.from(items).single().title)
        assertTrue(CinematicCatalogCollections.from(items.take(3)).isEmpty())
    }

    @Test fun noInventedOrLockedResultsAndBoundedCollectionCount() {
        val items = listOf(
            stream("a", "Spider-Man"), stream("a", "Spider-Man"),
            stream("b", "Spider-Man 2", locked = true),
            stream("c", "Unrelated")
        )
        assertTrue(CinematicCatalogCollections.from(items).isEmpty())
        assertTrue(CinematicCatalogCollections.from(items, maxCollections = 0).isEmpty())
        assertFalse(CinematicCatalogCollections.from(listOf(stream("one", "Batman"))).isNotEmpty())
    }
}
