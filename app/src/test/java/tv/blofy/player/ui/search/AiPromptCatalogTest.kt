package tv.blofy.player.ui.search

import org.junit.Assert.*
import org.junit.Test

class AiPromptCatalogTest {
    @Test fun promptsCoverManyCommonCustomerRequestsInBothLanguages() {
        assertEquals(10, AiPromptCatalog.groups.size)
        val prompts = AiPromptCatalog.groups.flatMap { it.prompts }
        assertTrue(prompts.size >= 60)
        assertEquals(prompts.size, prompts.map { it.ar }.distinct().size)
        assertEquals(prompts.size, prompts.map { it.en }.distinct().size)
        assertTrue(prompts.all {
            it.ar.length in 3..160 && it.en.length in 3..160 &&
                it.text("ar") == it.ar && it.text("en") == it.en
        })
        assertEquals(10, AiPromptCatalog.groups.map { it.id }.distinct().size)
    }

    @Test fun categoriesCoverFilmsSeriesActorsMoodsAndArabicContent() {
        val groups = AiPromptCatalog.groups.associateBy { it.id }
        listOf("action", "comedy", "suspense", "series", "family", "arabic",
            "world", "moods", "discovery", "lookup").forEach {
            assertNotNull(groups[it])
            assertTrue(groups.getValue(it).prompts.size >= 6)
        }
    }
}
