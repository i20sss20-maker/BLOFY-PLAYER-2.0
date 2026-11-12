package tv.blofy.player.core.playback

import androidx.media3.common.PlaybackException
import org.junit.Assert.*
import org.junit.Test

class PlaybackRecoveryPolicyTest {
    @Test fun permanentMissingEpisodeAndInvalidAccountAreNeverRetriedOnSameUrl() {
        for (status in listOf(400, 401, 403, 404, 410, 416, 422)) {
            assertNull(PlaybackRecoveryPolicy.delayForSameUrlRetry(
                PlaybackException.ERROR_CODE_IO_BAD_HTTP_STATUS,status,0,1))
        }
    }

    @Test fun overloadedSourceWaitsBrieflyBeforeOneRetryInsteadOfInstantReconnect() {
        assertEquals(900L,PlaybackRecoveryPolicy.delayForSameUrlRetry(
            PlaybackException.ERROR_CODE_IO_BAD_HTTP_STATUS,502,0,1))
        assertNull(PlaybackRecoveryPolicy.delayForSameUrlRetry(
            PlaybackException.ERROR_CODE_IO_BAD_HTTP_STATUS,429,0,1))
        assertEquals(550L,PlaybackRecoveryPolicy.delayForSameUrlRetry(
            PlaybackException.ERROR_CODE_IO_BAD_HTTP_STATUS,408,0,1))
        assertNull(PlaybackRecoveryPolicy.delayForSameUrlRetry(
            PlaybackException.ERROR_CODE_IO_BAD_HTTP_STATUS,408,2,1))
        assertEquals(550L,PlaybackRecoveryPolicy.delayForSameUrlRetry(
            PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_TIMEOUT,null,0,1))
        assertEquals(550L,PlaybackRecoveryPolicy.delayForSameUrlRetry(
            PlaybackException.ERROR_CODE_TIMEOUT,null,0,1))
    }

    @Test fun providerAdmissionDenialsNeverTriggerExtraSourceConnections() {
        for (status in listOf(401, 403, 429, 456)) {
            assertTrue(PlaybackRecoveryPolicy.isSourceAdmissionRefusal(status))
            assertNull(PlaybackRecoveryPolicy.delayForSameUrlRetry(
                PlaybackException.ERROR_CODE_IO_BAD_HTTP_STATUS, status, 0, 1))
            assertNull(PlaybackRecoveryPolicy.delayForSameUrlRetry(
                PlaybackException.ERROR_CODE_IO_BAD_HTTP_STATUS, status, 1, 1))
        }
        for (status in listOf(408, 500, 502, 503))
            assertFalse(PlaybackRecoveryPolicy.isSourceAdmissionRefusal(status))
    }

    @Test fun decoderAndUnsupportedFormatDoNotTriggerRepeatedNetworkRetries() {
        assertNull(PlaybackRecoveryPolicy.delayForSameUrlRetry(
            PlaybackException.ERROR_CODE_DECODING_FAILED,null,0,1))
        assertNull(PlaybackRecoveryPolicy.delayForSameUrlRetry(
            PlaybackException.ERROR_CODE_IO_BAD_HTTP_STATUS,200,0,1))
    }

    @Test fun repeatedIntermittentFailuresAreLimitedEvenIfFirstFramesSucceeded() {
        assertNull(PlaybackRecoveryPolicy.delayForSameUrlRetry(
            PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_FAILED,null,0,5))
        assertNull(PlaybackRecoveryPolicy.delayForSameUrlRetry(
            PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_FAILED,null,2,1))
        assertEquals(5000L to 1,PlaybackRecoveryPolicy.failureWindowCount(5000,0,0))
        assertEquals(5000L to 4,PlaybackRecoveryPolicy.failureWindowCount(5400,5000,3))
        assertEquals(65_000L to 1,PlaybackRecoveryPolicy.failureWindowCount(65_000,5000,4))
        assertEquals(42L to 1,PlaybackRecoveryPolicy.failureWindowCount(42,5000,4))
    }
}
