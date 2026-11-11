package tv.blofy.player.ui.details

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ArabicDetailsPolicyTest {
    @Test fun preservesArabicMovieNameWhenProviderReturnsEnglish() {
        assertEquals("الصقر والكناريا", ArabicDetailsPolicy.preferredTitle(
            "الصقر والكناريا", "Falcon and Canary (2026)", true))
    }
    @Test fun prefersArabicProvidedMetadataIfOriginalTitleIsEnglish() {
        assertEquals("الطريق إلى البيت", ArabicDetailsPolicy.preferredTitle(
            "The Way Home", "الطريق إلى البيت", true))
    }
    @Test fun englishLanguagePrefersProviderTitle() {
        assertEquals("Falcon and Canary", ArabicDetailsPolicy.preferredTitle(
            "الصقر والكناريا", "Falcon and Canary", false))
    }
    @Test fun preservesArabicSynopsisOverNewEnglishMetadata() {
        assertEquals("فيلم ممتع عن مغامرة جديدة.", ArabicDetailsPolicy.preferredOverview(
            "فيلم ممتع عن مغامرة جديدة.", "A funny adventure.", true))
    }
    @Test fun incompleteArabicMetadataDoesNotHideOriginalText() {
        assertEquals("A detective searches for clues", ArabicDetailsPolicy.preferredOverview(
            null, "A detective searches for clues", true))
    }
    @Test fun translateOnlyEnglishNotArabicOrEmptyText() {
        assertTrue(ArabicDetailsPolicy.needsTranslation("A comedy in London"))
        assertFalse(ArabicDetailsPolicy.needsTranslation("كوميديا ممتعة"))
        assertFalse(ArabicDetailsPolicy.needsTranslation("4K 2026"))
        assertFalse(ArabicDetailsPolicy.needsTranslation(""))
    }
}
