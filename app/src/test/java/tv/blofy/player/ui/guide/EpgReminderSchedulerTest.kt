package tv.blofy.player.ui.guide

import org.junit.Assert.assertEquals
import org.junit.Test

class EpgReminderSchedulerTest {
    @Test
    fun delayUntil_schedulesFiveMinutesBeforeProgram() {
        val now = 1_000_000L
        val start = now + 20 * 60_000L
        assertEquals(15 * 60_000L, EpgReminderScheduler.delayUntil(start, now))
    }

    @Test
    fun delayUntil_schedulesImmediatelyWhenProgramStartsWithinFiveMinutes() {
        val now = 1_000_000L
        val start = now + 2 * 60_000L
        assertEquals(1_000L, EpgReminderScheduler.delayUntil(start, now))
    }
}
