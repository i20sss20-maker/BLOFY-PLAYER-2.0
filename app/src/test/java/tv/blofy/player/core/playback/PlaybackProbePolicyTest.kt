package tv.blofy.player.core.playback

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PlaybackProbePolicyTest {
    @Test fun identifiesLoginPageEvenWithSuccessfulHttpStatus() {
        val result = PlaybackProbePolicy.summarize(200, "text/html; charset=utf-8")
        assertTrue(result.contains("HTML"))
        assertFalse(result.contains("http://"))
    }
    @Test fun distinguishesJsonResponseFromVideoBytes() {
        assertTrue(PlaybackProbePolicy.summarize(200, "application/json").contains("JSON"))
        assertTrue(PlaybackProbePolicy.summarize(206, "video/mp2t").contains("ناجح"))
    }
    @Test fun rejectsAuthErrorWithoutPublishingUrlOrCredentials() {
        val result = PlaybackProbePolicy.summarize(403, "application/vnd.apple.mpegurl")
        assertTrue(result.contains("HTTP 403"))
        assertFalse(result.contains("user"))
    }
    @Test fun explainsNetworkAndMissingContentSeparately() {
        assertTrue(PlaybackProbePolicy.summarize(404, null).contains("غير موجود"))
        assertTrue(PlaybackProbePolicy.summarize(503, null).contains("السيرفر"))
    }
}
