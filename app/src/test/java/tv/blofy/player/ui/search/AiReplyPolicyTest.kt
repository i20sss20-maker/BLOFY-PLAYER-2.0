package tv.blofy.player.ui.search

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class AiReplyPolicyTest {
    @Test fun rejectsUnsupportedAvailabilityClaims() {
        assertEquals("", AiReplyPolicy.safe("هذا الفيلم متوفر في سيرفرك"))
        assertEquals("", AiReplyPolicy.safe("Found https://example.com/watch"))
        assertEquals("", AiReplyPolicy.safe("Available in your playlist"))
    }
    @Test fun allowsNeutralShortAnswersOnly() {
        assertEquals("خلنا نبحث عن أكشن حديث!", AiReplyPolicy.safe("خلنا نبحث عن أكشن حديث!"))
        assertTrue(AiReplyPolicy.safe("x".repeat(500)).length <= 220)
    }
}
