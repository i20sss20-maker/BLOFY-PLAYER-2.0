package tv.blofy.player.core.playback

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PlaybackFailureHintTest {
    @Test fun networkFailuresAreRecognizableWithoutLeakingDetails() {
        val failure = PlaybackFailureHint.message("ERROR_CODE_IO_NETWORK_CONNECTION_TIMEOUT")
        assertTrue(failure.contains("مهلة"))
        val denied = PlaybackFailureHint.message("ERROR_CODE_IO_BAD_HTTP_STATUS")
        assertTrue(denied.contains("المصدر"))
        val codec = PlaybackFailureHint.message("ERROR_CODE_DECODING_FAILED")
        assertTrue(codec.contains("ترميز"))
        val fallback = PlaybackFailureHint.message("ERROR_CODE_UNSPECIFIED")
        assertTrue(fallback.contains("تعذّر"))
    }

    @Test fun noRawErrorContentOrPrivateUrlIsEverEchoed() {
        val secret = "https://private.example/live/u/password.ts?token=secret"
        val output = PlaybackFailureHint.message(secret)
        assertFalse(output.contains("private.example"))
        assertFalse(output.contains("token"))
        assertFalse(output.contains("password"))
    }
}
