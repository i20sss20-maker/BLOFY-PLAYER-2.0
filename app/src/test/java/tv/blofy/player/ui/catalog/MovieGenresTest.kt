package tv.blofy.player.ui.catalog

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class MovieGenresTest {
    @Test fun bilingualGenresFromProviderTags() {
        assertEquals(setOf("action","comedy"), MovieGenres.identify("Action, Comedy"))
        assertEquals(setOf("comedy","drama"), MovieGenres.identify("كوميديا / دراما"))
        assertEquals(setOf("scifi"), MovieGenres.identify("Science Fiction"))
    }
    @Test fun categoryFallbackWorksWithoutMovieGenre() {
        assertTrue("action" in MovieGenres.identify(null, "Movies | Action"))
        assertTrue("comedy" in MovieGenres.identify(null, "أفلام كوميديا"))
        assertTrue(MovieGenres.identify(null, "4K / Latest Releases").isEmpty())
    }
    @Test fun noTitleGuessingAndNoPartialEnglishWords() {
        assertTrue(MovieGenres.identify(null, null).isEmpty())
        assertFalse("war" in MovieGenres.identify("software"))
        assertFalse("action" in MovieGenres.identify("Interaction"))
    }
    @Test fun providerFilterUsesBoundParametersWithKeysetPagination() {
        val query = MovieGenres.catalogQuery("provider-secret", null, "action", 188L, 64)
        assertTrue(query.sql.contains("s.rowid > ?"))
        assertTrue(query.sql.contains("ORDER BY s.rowid LIMIT ?"))
        assertFalse(query.sql.contains("provider-secret"))
        val count = MovieGenres.catalogQuery("provider-secret", "18", "action", countOnly = true)
        assertTrue(count.sql.contains("SELECT COUNT(*)"))
        assertTrue(count.sql.contains("s.categoryId = ?"))
    }
    @Test fun englishLabelsRemainEnglishWhenEnglishSelected() {
        assertEquals("Comedy", MovieGenres.label("Comedy", false))
        assertEquals("كوميديا", MovieGenres.label("Comedy", true))
    }
}
