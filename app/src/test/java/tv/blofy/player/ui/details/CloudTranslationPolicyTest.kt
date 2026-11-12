package tv.blofy.player.ui.details

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class CloudTranslationPolicyTest {
    @Test fun remoteTextIsNeverSentBeforeExplicitCloudConsent() {
        assertFalse(CloudTranslationPolicy.shouldRequest(true,true,false,true,false))
    }
    @Test fun oldNonStreamOrNonArabicAppNeverUsesGroq() {
        assertFalse(CloudTranslationPolicy.shouldRequest(false,true,true,true,false))
        assertFalse(CloudTranslationPolicy.shouldRequest(true,false,true,true,false))
    }
    @Test fun cachedTranslationDoesNotCostTokensAgain() {
        assertFalse(CloudTranslationPolicy.shouldRequest(true,true,true,true,true))
        assertFalse(CloudTranslationPolicy.shouldRequest(true,true,true,false,false))
    }
    @Test fun optedInEnglishTextCanBeTranslated() {
        assertTrue(CloudTranslationPolicy.shouldRequest(true,true,true,true,false))
    }
}
