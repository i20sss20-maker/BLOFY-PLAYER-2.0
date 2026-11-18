package tv.blofy.player.core.playback

import org.junit.Assert.*
import org.junit.Test

class LiveCleanEndRecoveryPolicyTest {
    @Test fun liveTransportClosingAfterOneMinuteReopensSameChannel() {
        val plan = LiveCleanEndRecoveryPolicy.next(81_289L, 2)
        assertEquals(0, plan?.quickEnds)
        assertEquals(900L, plan?.delayMs)
        assertEquals(900L, LiveCleanEndRecoveryPolicy.next(104_443L, 0)?.delayMs)
    }

    @Test fun brieflyClosingSourceUsesBoundedBackoffNotInfiniteTightLoops() {
        assertEquals(LiveCleanEndRecoveryPolicy.Plan(1, 900L),
            LiveCleanEndRecoveryPolicy.next(0L, 0))
        assertEquals(LiveCleanEndRecoveryPolicy.Plan(2, 2_000L),
            LiveCleanEndRecoveryPolicy.next(1_200L, 1))
        assertEquals(LiveCleanEndRecoveryPolicy.Plan(3, 4_000L),
            LiveCleanEndRecoveryPolicy.next(6_000L, 2))
        assertNull(LiveCleanEndRecoveryPolicy.next(8_000L, 3))
    }

    @Test fun stablePlaybackResetsShortFailureCounter() {
        assertEquals(LiveCleanEndRecoveryPolicy.Plan(0, 900L),
            LiveCleanEndRecoveryPolicy.next(15_000L, 3))
        assertEquals(LiveCleanEndRecoveryPolicy.Plan(1, 900L),
            LiveCleanEndRecoveryPolicy.next(1_000L, 0))
    }
}
