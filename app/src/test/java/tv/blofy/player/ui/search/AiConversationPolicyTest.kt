package tv.blofy.player.ui.search

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AiConversationPolicyTest {
    @Test fun newQuestionIsIndependent() {
        assertEquals("رشح لي فيلم أكشن جديد",
            AiConversationPolicy.prompt("رشح مسلسل رعب", "رشح لي فيلم أكشن جديد"))
    }
    @Test fun contextualFollowupIsBounded() {
        val q = AiConversationPolicy.prompt("رشح فيلم أكشن 2025", "طيب عطيني غيره")
        assertTrue(q.contains("فيلم أكشن 2025"))
        assertTrue(q.contains("غيره"))
        assertTrue(q.length <= 160)
    }
    @Test fun recentIntentDoesNotForceYear() {
        assertTrue(AiConversationPolicy.wantsRecent("أبغى فيلم جديد"))
        assertTrue(AiConversationPolicy.wantsRecent("latest action movies"))
        assertFalse(AiConversationPolicy.wantsRecent("فيلم من 2010"))
    }
}
