package tv.blofy.player.ui.search

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AiChatRoutingPolicyTest {
    @Test fun movieAndSeriesRequestsStaySeparate() {
        assertEquals(listOf("movie"), AiChatRoutingPolicy.kinds("رشح لي فيلم أكشن"))
        assertEquals(listOf("series"), AiChatRoutingPolicy.kinds("رشح لي مسلسل جريمة"))
        assertEquals(listOf("movie", "series"), AiChatRoutingPolicy.kinds("وش تنصحني؟"))
        assertEquals(listOf("movie", "series"), AiChatRoutingPolicy.kinds("movies and series"))
    }
    @Test fun alternativesNeverReplaceAnActorSearch() {
        assertTrue(AiChatRoutingPolicy.maySuggestAlternatives("رشح لي أكشن", ""))
        assertFalse(AiChatRoutingPolicy.maySuggestAlternatives("أفلام توم كروز", "Tom Cruise"))
        assertFalse(AiChatRoutingPolicy.maySuggestAlternatives("ابحث عن فيلم الزعيم", ""))
    }
}
