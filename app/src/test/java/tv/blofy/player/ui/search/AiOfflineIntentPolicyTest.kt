package tv.blofy.player.ui.search

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class AiOfflineIntentPolicyTest {
    @Test fun arabicGenreRecommendationRemainsLocalAndFiltered() {
        val parsed = AiOfflineIntentPolicy.parse("رشح لي فيلم أكشن جديد")
        assertEquals("action", parsed.genre)
        assertEquals("movie", parsed.kind)
        assertTrue(parsed.suggestedTitles.isEmpty())
        assertEquals("", parsed.title)
    }

    @Test fun exactTitleSearchDoesNotFabricateSuggestions() {
        val parsed = AiOfflineIntentPolicy.parse("ابحث عن فيلم عسل أسود")
        assertEquals("عسل أسود", parsed.title)
        assertEquals("", parsed.genre)
    }

    @Test fun englishRequestsKeepSeparateMovieAndSeriesFilters() {
        val parsed = AiOfflineIntentPolicy.parse("Recommend a comedy series")
        assertEquals("series", parsed.kind)
        assertEquals("comedy", parsed.genre)
    }
}
