package tv.blofy.player.ui.search

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AiRecommendationRankerTest {
    @Test fun bilingualGenresAreMatchedAgainstRealMetadata() {
        assertEquals("action", AiRecommendationRanker.requestedGenre("رشح اكشن جديد", ""))
        assertEquals("comedy", AiRecommendationRanker.requestedGenre("شيء مضحك", "Comedy"))
        assertTrue(AiRecommendationRanker.matchesGenre("Action / Thriller", "action"))
        assertTrue(AiRecommendationRanker.matchesGenre("أكشن / دراما", "action"))
        assertFalse(AiRecommendationRanker.matchesGenre("Drama", "action"))
    }
    @Test fun numericRatingsStayBounded() {
        assertEquals(8.5, AiRecommendationRanker.rating("8,5/10"), 0.00001)
        assertEquals(0.0, AiRecommendationRanker.rating("100/100"), 0.00001)
    }
}
