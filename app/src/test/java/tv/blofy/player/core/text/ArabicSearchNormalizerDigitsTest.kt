package tv.blofy.player.core.text

import org.junit.Assert.assertEquals
import org.junit.Test

class ArabicSearchNormalizerDigitsTest {
    @Test fun arabicAndPersianYearsMatchAsciiCatalogYears() {
        assertEquals("افلام 2026", ArabicSearchNormalizer.normalize("أفلام ٢٠٢٦"))
        assertEquals("2026", ArabicSearchNormalizer.normalize("۲۰۲۶"))
        assertEquals(ArabicSearchNormalizer.ftsQuery("فيلم 2026"),
            ArabicSearchNormalizer.ftsQuery("فيلم ٢٠٢٦"))
    }
}
