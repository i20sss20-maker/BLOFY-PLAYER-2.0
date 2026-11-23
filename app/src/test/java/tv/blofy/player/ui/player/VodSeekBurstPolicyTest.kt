package tv.blofy.player.ui.player

import org.junit.Assert.assertEquals
import org.junit.Test

/** Pure arithmetic tests: no actual subscriber stream or HTTP connection. */
class VodSeekBurstPolicyTest {
    @Test fun manyRemoteRepeatsAccumulateIntoOneFinalRangeTarget() {
        val first = VodSeekBurstPolicy.target(60_000L, null, 10_000L, 300_000L)
        val second = VodSeekBurstPolicy.target(60_000L, first, 15_000L, 300_000L)
        val third = VodSeekBurstPolicy.target(60_000L, second, 30_000L, 300_000L)
        assertEquals(115_000L, third)
        assertEquals(300L, VodSeekBurstPolicy.COMMIT_DELAY_MS)
    }

    @Test fun backwardSeekingCannotGoBelowStart() {
        assertEquals(0L, VodSeekBurstPolicy.target(2_000L, null, -30_000L, 300_000L))
        assertEquals(0L, VodSeekBurstPolicy.target(1L, null, Long.MIN_VALUE, null))
    }

    @Test fun seekAtEndClampsEvenWhenPositionArithmeticCouldOverflow() {
        assertEquals(300_000L, VodSeekBurstPolicy.target(Long.MAX_VALUE - 2, null, 30_000L, 300_000L))
        assertEquals(Long.MAX_VALUE, VodSeekBurstPolicy.target(Long.MAX_VALUE - 2, null, 30_000L, null))
    }

    @Test fun missingDurationStillPreservesPositivePosition() {
        assertEquals(95_000L, VodSeekBurstPolicy.target(60_000L, 80_000L, 15_000L, -1L))
    }
}
