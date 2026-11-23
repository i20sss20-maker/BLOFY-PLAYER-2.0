package tv.blofy.player.core.playback

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PlaybackRecoveryPolicyTest {
    @Test fun briefTwoSecondSourceReconnectionNeverReinitializesDecoder() {
        assertFalse(PlaybackRecoveryPolicy.shouldRecoverLiveBuffering(
            stalledForMs = 2_000L, nowMs = 100_000L,
            lastRecoveryAtMs = 0L, recoveries = 0
        ))
    }

    @Test fun recoveringNormalBuffersDoNotRestartOnFlatLiveTimeline() {
        assertFalse(PlaybackRecoveryPolicy.shouldRecoverLiveBuffering(
            stalledForMs = 12_000L, nowMs = 60_000L,
            lastRecoveryAtMs = 0L, recoveries = 0
        ))
    }

    @Test fun prolongedBufferingCanRecoverEvenShortlyAfterAndroidBoot() {
        assertTrue(PlaybackRecoveryPolicy.shouldRecoverLiveBuffering(
            stalledForMs = 25_000L, nowMs = 30_000L,
            lastRecoveryAtMs = 0L, recoveries = 0
        ))
    }

    @Test fun repeatedRestartsHaveCooldownAndMaximumPerChannel() {
        assertFalse(PlaybackRecoveryPolicy.shouldRecoverLiveBuffering(
            stalledForMs = 25_000L, nowMs = 40_000L,
            lastRecoveryAtMs = 30_000L, recoveries = 1
        ))
        assertTrue(PlaybackRecoveryPolicy.shouldRecoverLiveBuffering(
            stalledForMs = 25_000L, nowMs = 91_000L,
            lastRecoveryAtMs = 30_000L, recoveries = 2
        ))
        assertFalse(PlaybackRecoveryPolicy.shouldRecoverLiveBuffering(
            stalledForMs = 25_000L, nowMs = 190_000L,
            lastRecoveryAtMs = 91_000L, recoveries = 3
        ))
    }


    @Test fun streamGatewayWaitsForExistingLiveRecoveryBeforeResettingSurface() {
        val gatewayGrace = PlaybackRecoveryPolicy.liveBufferGraceMs(
            isCodeOnlyGateway = true, wasReady = true
        )
        assertTrue(gatewayGrace > PlaybackRecoveryPolicy.LIVE_REBUFFER_GRACE_MS)
        assertFalse(PlaybackRecoveryPolicy.shouldRecoverLiveBuffering(
            stalledForMs = 25_000L, nowMs = 100_000L,
            lastRecoveryAtMs = 0L, recoveries = 0, graceMs = gatewayGrace
        ))
        assertTrue(PlaybackRecoveryPolicy.shouldRecoverLiveBuffering(
            stalledForMs = gatewayGrace, nowMs = 100_000L,
            lastRecoveryAtMs = 0L, recoveries = 0, graceMs = gatewayGrace
        ))
    }

    @Test fun initialGatewayLoadAndNormalPlayerRetainFastRecovery() {
        assertTrue(PlaybackRecoveryPolicy.liveBufferGraceMs(
            isCodeOnlyGateway = true, wasReady = false
        ) == PlaybackRecoveryPolicy.LIVE_REBUFFER_GRACE_MS)
        assertTrue(PlaybackRecoveryPolicy.liveBufferGraceMs(
            isCodeOnlyGateway = false, wasReady = true
        ) == PlaybackRecoveryPolicy.LIVE_REBUFFER_GRACE_MS)
        assertTrue(PlaybackRecoveryPolicy.shouldRecoverLiveBuffering(
            stalledForMs = 25_000L, nowMs = 25_000L,
            lastRecoveryAtMs = 0L, recoveries = 0,
            graceMs = PlaybackRecoveryPolicy.liveBufferGraceMs(true, false)
        ))
    }

    @Test fun onlyAuthenticatedStreamVodRetriesTransientNetworkErrorsMoreThanOnce() {
        val eligible = listOf(
            "ERROR_CODE_IO_NETWORK_CONNECTION_FAILED",
            "ERROR_CODE_IO_NETWORK_CONNECTION_TIMEOUT"
        )
        for (code in eligible) {
            assertTrue(PlaybackRecoveryPolicy.maxErrorRetries(
                isCodeOnlyGateway = true, contentKind = "episode",
                errorCodeName = code
            ) == 3)
            assertTrue(PlaybackRecoveryPolicy.maxErrorRetries(
                isCodeOnlyGateway = true, contentKind = "movie",
                errorCodeName = code
            ) == 3)
            assertTrue(PlaybackRecoveryPolicy.maxErrorRetries(
                isCodeOnlyGateway = false, contentKind = "movie",
                errorCodeName = code
            ) == 1)
            assertTrue(PlaybackRecoveryPolicy.maxErrorRetries(
                isCodeOnlyGateway = true, contentKind = "live",
                errorCodeName = code
            ) == 1)
        }
    }

    @Test fun badHttpCredentialsAndCodecErrorsNeverReceiveMoreRetries() {
        for (status in listOf(401, 403, 404, 416, 429, 456, 509)) {
            assertTrue(PlaybackRecoveryPolicy.maxErrorRetries(
                isCodeOnlyGateway = true, contentKind = "episode",
                errorCodeName = "ERROR_CODE_IO_BAD_HTTP_STATUS",
                httpStatus = status
            ) == 1)
        }
        for (status in listOf(408, 500, 502, 503, 504)) {
            assertTrue(PlaybackRecoveryPolicy.maxErrorRetries(
                isCodeOnlyGateway = true, contentKind = "episode",
                errorCodeName = "ERROR_CODE_IO_BAD_HTTP_STATUS",
                httpStatus = status
            ) == 3)
        }
        assertTrue(PlaybackRecoveryPolicy.maxErrorRetries(
            isCodeOnlyGateway = true, contentKind = "episode",
            errorCodeName = "ERROR_CODE_DECODING_FAILED"
        ) == 1)
        assertTrue(PlaybackRecoveryPolicy.maxErrorRetries(
            isCodeOnlyGateway = true, contentKind = "episode",
            errorCodeName = "ERROR_CODE_IO_BAD_HTTP_STATUS"
        ) == 1)
    }

    @Test fun streamVodRetryBackoffStaysBoundedAndNormalPlayerIsUnchanged() {
        assertTrue(PlaybackRecoveryPolicy.errorRetryDelayMs(1, 3) == 800L)
        assertTrue(PlaybackRecoveryPolicy.errorRetryDelayMs(2, 3) == 1_600L)
        assertTrue(PlaybackRecoveryPolicy.errorRetryDelayMs(3, 3) == 3_000L)
        assertTrue(PlaybackRecoveryPolicy.errorRetryDelayMs(1, 1) == 600L)
    }

    @Test fun nextOutageAfterHealthyPlaybackGetsFreshSingleRetry() {
        assertTrue(PlaybackRecoveryPolicy.recoveredLongEnoughToResetErrorRetry(
            lastReadyAtMs = 100_000L, nowMs = 131_000L
        ))
        assertFalse(PlaybackRecoveryPolicy.recoveredLongEnoughToResetErrorRetry(
            lastReadyAtMs = 100_000L, nowMs = 112_000L
        ))
        assertFalse(PlaybackRecoveryPolicy.recoveredLongEnoughToResetErrorRetry(
            lastReadyAtMs = 0L, nowMs = 100_000L
        ))
        assertFalse(PlaybackRecoveryPolicy.recoveredLongEnoughToResetErrorRetry(
            lastReadyAtMs = 100_000L, nowMs = 90_000L
        ))
    }

    @Test fun timeDiscontinuitiesNeverTriggerBusyRetryLoop() {
        assertFalse(PlaybackRecoveryPolicy.shouldRecoverLiveBuffering(
            stalledForMs = 25_000L, nowMs = 25_000L,
            lastRecoveryAtMs = 95_000L, recoveries = 1
        ))
    }
}
