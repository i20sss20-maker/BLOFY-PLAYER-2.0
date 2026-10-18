package tv.blofy.player.core.playback

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PlaybackFailurePolicyTest {
    @Test fun recognizesExpiredOrForbiddenCredentialsWithoutTransportLoop() {
        for (code in listOf(401, 403)) {
            val failure = PlaybackFailurePolicy.describe("ERROR_CODE_IO_BAD_HTTP_STATUS", code)
            assertTrue(failure.authFailure)
            assertFalse(failure.tryHttpTransport)
            assertTrue(failure.message.contains("HTTP $code"))
        }
    }

    @Test fun retriesConnectionFailuresWithHttpTransport() {
        val failure = PlaybackFailurePolicy.describe("ERROR_CODE_IO_NETWORK_CONNECTION_FAILED")
        assertFalse(failure.authFailure)
        assertTrue(failure.tryHttpTransport)
    }

    @Test fun doesNotTreatUnsupportedDecoderAsNetworkError() {
        val failure = PlaybackFailurePolicy.describe("ERROR_CODE_DECODING_FAILED")
        assertFalse(failure.tryHttpTransport)
        assertTrue(failure.message.contains("الترميز"))
    }

    @Test fun neverPrintsStreamUriOrCredentialsInFailures() {
        val failure = PlaybackFailurePolicy.describe("ERROR_CODE_IO_BAD_HTTP_STATUS", 404)
        assertFalse(failure.message.contains("password"))
        assertFalse(failure.tryHttpTransport)
    }
}
