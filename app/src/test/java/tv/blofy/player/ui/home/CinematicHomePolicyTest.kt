package tv.blofy.player.ui.home

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import tv.blofy.player.data.local.StreamEntity

class CinematicHomePolicyTest {
    private fun title(key: String, name: String, kind: String = "movie",
                      artwork: String? = null, backdrop: String? = null, locked: Boolean = false): StreamEntity =
        StreamEntity(key = key, providerId = "user-provider", remoteId = key,
            categoryId = null, kind = kind, name = name, icon = artwork,
            backdrop = backdrop, locked = locked)

    @Test fun heroPrefersRealBackdropsAndNeverFeaturesLockedContent() {
        val items = listOf(
            title("a", "No art"),
            title("b", "Movie poster", artwork = "https://example.test/poster.jpg"),
            title("c", "Hero", backdrop = "https://example.test/wide.jpg"),
            title("d", "Locked title", backdrop = "https://example.test/locked.jpg", locked = true)
        )
        val selected = CinematicHomePolicy.heroCandidates(items, 3)
        assertEquals(listOf("c", "b", "a"), selected.map { it.key })
        assertFalse(selected.any { it.locked })
    }

    @Test fun collectionOnlyAppearsWithAtLeastTwoMatchingOwnedTitles() {
        val items = listOf(
            title("a", "Spider-Man"),
            title("b", "The Amazing Spider Man 2"),
            title("c", "Harry Potter"),
            title("d", "Spider-Man", locked = true),
            title("e", "Unrelated")
        )
        val result = CinematicHomePolicy.universeRails(items)
        assertEquals(1, result.size)
        assertEquals("عالم Spider-Man", result.single().title)
        assertEquals(listOf("a", "b"), result.single().items.map { it.key })
    }

    @Test fun noFakeBadgesOrExternalPopularityNumbers() {
        assertEquals("★ 7.4", CinematicHomePolicy.ratingBadge("7.4"))
        assertEquals(null, CinematicHomePolicy.ratingBadge(null))
        assertEquals(null, CinematicHomePolicy.ratingBadge("94%"))
        assertEquals(null, CinematicHomePolicy.ratingBadge("IMDb 8.8"))
        assertEquals(null, CinematicHomePolicy.ratingBadge("999"))
        assertTrue(CinematicHomePolicy.heroCandidates(emptyList()).isEmpty())
    }
}
