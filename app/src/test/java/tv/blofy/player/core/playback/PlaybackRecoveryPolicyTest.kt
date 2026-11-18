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
