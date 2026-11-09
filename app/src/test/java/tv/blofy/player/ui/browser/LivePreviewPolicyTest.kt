package tv.blofy.player.ui.browser

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class LivePreviewPolicyTest {
    @Test fun automaticPreviewRequiresAnUnblockedStableSelection() {
        assertTrue(LivePreviewPolicy.FOCUS_DEBOUNCE_MS >= 1000L)
        assertTrue(LivePreviewPolicy.shouldSchedule(true,false,false))
        assertFalse(LivePreviewPolicy.shouldSchedule(false,false,false))
        assertFalse(LivePreviewPolicy.shouldSchedule(true,true,false))
        assertFalse(LivePreviewPolicy.shouldSchedule(true,false,true))
    }
}
