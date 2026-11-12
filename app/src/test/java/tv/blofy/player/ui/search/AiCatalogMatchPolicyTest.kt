package tv.blofy.player.ui.search

import org.junit.Assert.*
import org.junit.Test
import tv.blofy.player.data.local.StreamEntity

class AiCatalogMatchPolicyTest {
    private fun film(name: String, kind: String = "movie", locked: Boolean = false) =
        StreamEntity(key = "p:$name", providerId = "p", remoteId = "17",
            categoryId = "all", kind = kind, name = name, locked = locked)

    @Test fun onlyActualCatalogTitlesAppearFromAiSuggestions() {
        val available = listOf(film("EN - Mission: Impossible (1996)"),
            film("New Unrelated Drama"), film("Ghost Protocol"), film("Top Gun (1986)"))
        val found = AiCatalogMatchPolicy.filterVerified(
            listOf("Mission: Impossible", "Imaginary Film XYZ", "Top Gun"), available)
        assertTrue(found.any { it.name.contains("Top Gun") })
        assertTrue(found.none { it.name.contains("Unrelated") })
    }

    @Test fun neverRecommendsLockedOrLiveStreams() {
        val available = listOf(film("Top Gun", locked = true), film("Top Gun", "live"))
        assertTrue(AiCatalogMatchPolicy.filterVerified(listOf("Top Gun"), available).isEmpty())
    }

    @Test fun expensiveAiRunsOnlyOnExplicitSearchOrStalledNaturalQuery() {
        assertFalse(AiCatalogMatchPolicy.worthwhile("Tom", 0, false))
        assertTrue(AiCatalogMatchPolicy.worthwhile("Tom Cruise", 0, false))
        assertFalse(AiCatalogMatchPolicy.worthwhile("Tom Cruise", 2, false))
        assertTrue(AiCatalogMatchPolicy.worthwhile("Tom Cruise", 2, true))
    }
}
