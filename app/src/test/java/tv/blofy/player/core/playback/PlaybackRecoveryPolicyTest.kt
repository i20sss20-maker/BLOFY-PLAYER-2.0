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
        assertEquals(1500L,PlaybackRecoveryPolicy.delayForSameUrlRetry(
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
    @Test fun gatewayLiveOnlyExtendsGraceAfterReady() {
        assertEquals(12_000L, PlaybackRecoveryPolicy.liveBufferGraceMs(true, false))
        assertEquals(12_000L, PlaybackRecoveryPolicy.liveBufferGraceMs(false, true))
        assertEquals(58_000L, PlaybackRecoveryPolicy.liveBufferGraceMs(true, true))
    }

    @Test fun gatewayVodRetriesAreBoundedAndRejectPermanentFailures() {
        val error = PlaybackException.ERROR_CODE_IO_BAD_HTTP_STATUS
        assertEquals(800L, PlaybackRecoveryPolicy.gatewayVodRetryDelay(error, 503, 0, 1))
        assertEquals(1_600L, PlaybackRecoveryPolicy.gatewayVodRetryDelay(error, 502, 1, 2))
        assertEquals(3_000L, PlaybackRecoveryPolicy.gatewayVodRetryDelay(error, 408, 2, 3))
        assertNull(PlaybackRecoveryPolicy.gatewayVodRetryDelay(error, 503, 3, 4))
        assertNull(PlaybackRecoveryPolicy.gatewayVodRetryDelay(error, 503, 0, 5))
        for (status in listOf(401, 403, 404, 416, 429))
            assertNull(PlaybackRecoveryPolicy.gatewayVodRetryDelay(error, status, 0, 1))
        assertNull(PlaybackRecoveryPolicy.gatewayVodRetryDelay(PlaybackException.ERROR_CODE_DECODING_FAILED, null, 0, 1))
    }
}
