package tv.blofy.player.ui.player

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class StreamAudioRetryPolicyTest {
    @Test fun transient415IsRetriedExactlyOnce() {
        assertTrue(StreamAudioRetryPolicy.shouldRetryInvalidAudio(0))
        assertFalse(StreamAudioRetryPolicy.shouldRetryInvalidAudio(1))
        assertFalse(StreamAudioRetryPolicy.shouldRetryInvalidAudio(2))
        assertFalse(StreamAudioRetryPolicy.shouldRetryInvalidAudio(-1))
    }
}
