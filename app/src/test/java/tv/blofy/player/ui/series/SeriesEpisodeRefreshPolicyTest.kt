package tv.blofy.player.ui.series

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SeriesEpisodeRefreshPolicyTest {
    @Test fun firstVisitToCachedSeriesCanRefreshEpisodesSilently() {
        assertTrue(SeriesEpisodeRefreshPolicy.shouldAttempt(0L, 0L, 100_000_000L))
    }

    @Test fun newlyCheckedSeriesIsNotFetchedRepeatedlyWhenOpeningEpisodes() {
        val now = 100_000_000L
        val successfulAt = now - SeriesEpisodeRefreshPolicy.SUCCESS_GAP_MS
        assertTrue(SeriesEpisodeRefreshPolicy.shouldAttempt(successfulAt, 0L, now))
        assertFalse(SeriesEpisodeRefreshPolicy.shouldAttempt(successfulAt + 1L, 0L, now))
    }

    @Test fun transientEpisodeSourceFailureUsesShortRetryGuardWithoutClearingCache() {
        val now = 100_000_000L
        val previous = now - SeriesEpisodeRefreshPolicy.FAILURE_RETRY_GAP_MS
        assertFalse(SeriesEpisodeRefreshPolicy.shouldAttempt(0L, previous + 1L, now))
        assertTrue(SeriesEpisodeRefreshPolicy.shouldAttempt(0L, previous, now))
        assertFalse(SeriesEpisodeRefreshPolicy.shouldAttempt(0L, now, now - 1L))
    }

    @Test fun visibleSeriesReceivesNewEpisodesWithinThreeMinutesWithoutFloodingSource() {
        val now = 100_000_000L
        val refreshGap = 3L * 60_000L
        org.junit.Assert.assertEquals(refreshGap, SeriesEpisodeRefreshPolicy.SUCCESS_GAP_MS)
        org.junit.Assert.assertEquals(refreshGap, SeriesEpisodeRefreshPolicy.FAILURE_RETRY_GAP_MS)
        assertFalse(SeriesEpisodeRefreshPolicy.shouldAttempt(now - refreshGap + 1L, 0L, now))
        assertFalse(SeriesEpisodeRefreshPolicy.shouldAttempt(now - refreshGap, now - refreshGap + 1L, now))
        assertTrue(SeriesEpisodeRefreshPolicy.shouldAttempt(now - refreshGap, now - refreshGap, now))
    }
}
