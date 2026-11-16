package tv.blofy.player.ui.player

import org.junit.Assert.assertEquals
import org.junit.Test

class ArabicSidecarTimingPolicyTest {
    @Test fun delayIsBoundedForNonseekableLiveSources() {
        assertEquals(0, ArabicSidecarTimingPolicy.adjust(0, -1))
        assertEquals(1, ArabicSidecarTimingPolicy.adjust(0, 1))
        assertEquals(29, ArabicSidecarTimingPolicy.adjust(30, -1))
        assertEquals(30, ArabicSidecarTimingPolicy.adjust(30, 1))
        assertEquals(30, ArabicSidecarTimingPolicy.adjust(Int.MAX_VALUE, Int.MAX_VALUE))
        assertEquals(0, ArabicSidecarTimingPolicy.clamp(-1000))
    }

    @Test fun reversingNonSeekableLiveAudioAccumulatesDelayWithoutSilence() {
        val rate = ArabicSidecarTimingPolicy.SLOW_DOWN_RATE
        val ms = ArabicSidecarTimingPolicy.wallTimeToSyncMs(1_000.0, rate)
        assertEquals(5_000.0, ms.toDouble(), 3.0)
        val actual = ArabicSidecarTimingPolicy.estimatedOffsetMs(0.0, ms, rate)
        assertEquals(1_000.0, actual, 1.0)
        assertEquals(0.0, ArabicSidecarTimingPolicy.estimatedOffsetMs(0.0, 5_000L, 1.25f), 0.1)
        val drained = ArabicSidecarTimingPolicy.estimatedOffsetMs(2_000.0, 4_000L, 1.25f)
        assertEquals(1_000.0, drained, 1.0)
    }

    @Test fun advancingReducesDelayWithoutInventingFutureAudio() {
        assertEquals(1, ArabicSidecarTimingPolicy.secondsToCatchUp(5, 4))
        assertEquals(0, ArabicSidecarTimingPolicy.secondsToCatchUp(0, 0))
        assertEquals(4000L, ArabicSidecarTimingPolicy.catchUpWallTimeMs(1))
        assertEquals(8000L, ArabicSidecarTimingPolicy.catchUpWallTimeMs(2))
    }
}
