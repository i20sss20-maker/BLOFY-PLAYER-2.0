package tv.blofy.player.ui.search

import org.junit.Assert.*
import org.junit.Test

class AiCatalogQueryPolicyTest {
    @Test fun arabicNumbersWorkEvenWithoutGroqGuessingYear() {
        assertEquals(2026, AiCatalogQueryPolicy.explicitYear("أفلام ٢٠٢٦"))
        assertEquals(2026, AiCatalogQueryPolicy.explicitYear("movies 2026"))
        assertEquals(2024, AiCatalogQueryPolicy.explicitYear("مسلسلات ۲۰۲۴"))
    }
    @Test fun actorQueryNeverInheritsAnInventedYear() {
        assertNull(AiCatalogQueryPolicy.explicitYear("أفلام أحمد حلمي"))
        assertNull(AiCatalogQueryPolicy.explicitYear("Tom Cruise"))
    }
    @Test fun yearMatchesCatalogTitleWhenSourceYearFieldIsEmpty() {
        assertTrue(AiCatalogQueryPolicy.matchesYear(null,"IN - Cocktail 2 (2026)",2026))
        assertTrue(AiCatalogQueryPolicy.matchesYear("2026","IN - Film",2026))
        assertFalse(AiCatalogQueryPolicy.matchesYear("2024","IN - Film 2024",2026))
    }
}
