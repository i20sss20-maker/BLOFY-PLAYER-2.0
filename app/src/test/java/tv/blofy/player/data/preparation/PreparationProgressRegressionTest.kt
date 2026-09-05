package tv.blofy.player.data.preparation

import org.junit.Assert.*
import org.junit.Test

class PreparationProgressRegressionTest {
    @Test fun stagesNeverReachOneHundredWithoutFinalVerification() {
        PreparationProgress.Stage.values().forEach { stage ->
            assertTrue(PreparationProgress.percent(stage, 10, 10) < 100)
        }
    }

    @Test fun countsAdvanceMonotonicallyAcrossAllStages() {
        var previous = 0
        PreparationProgress.Stage.values().forEach { stage ->
            for (done in 0L..100L) {
                val current = PreparationProgress.percent(stage, done, 100)
                assertTrue(current >= previous)
                assertTrue(current in stage.start..stage.end)
                previous = current
            }
        }
    }

    @Test fun onlyDurableCountChangesThePercentage() {
        assertEquals(45, PreparationProgress.percent(PreparationProgress.Stage.DETAILS, 50, 100))
        repeat(100) { assertEquals(45, PreparationProgress.percent(PreparationProgress.Stage.DETAILS, 50, 100)) }
    }

    @Test fun emptyStageCanAdvanceButDoesNotCompleteWholeLibrary() {
        assertEquals(60, PreparationProgress.percent(PreparationProgress.Stage.DETAILS, 0, 0))
        assertFalse(PreparationProgress.canComplete(0, 0, false))
    }

    @Test fun anyPendingDetailOrImagePreventsCompletion() {
        assertFalse(PreparationProgress.canComplete(1, 0, true))
        assertFalse(PreparationProgress.canComplete(0, 1, true))
        assertFalse(PreparationProgress.canComplete(1, 1, true))
        assertTrue(PreparationProgress.canComplete(0, 0, true))
    }

    @Test fun largeCountsCannotRoundUpToPrematureStageCompletion() {
        assertEquals(94, PreparationProgress.percent(PreparationProgress.Stage.ARTWORK, Long.MAX_VALUE - 1, Long.MAX_VALUE))
        assertEquals(95, PreparationProgress.percent(PreparationProgress.Stage.ARTWORK, Long.MAX_VALUE, Long.MAX_VALUE))
    }

    @Test(expected = IllegalArgumentException::class)
    fun completedCountCannotExceedTotal() {
        PreparationProgress.percent(PreparationProgress.Stage.DETAILS, 2, 1)
    }

    @Test(expected = IllegalArgumentException::class)
    fun negativePendingCountIsNotSuccess() {
        PreparationProgress.canComplete(-1, 0, true)
    }
}
