package tv.blofy.player.core.remote

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class FocusCheckpointStoreTest {
    @Test fun keepsEpisodeAndSeasonSelectionSeparate() {
        var time = 1_000L
        val store = FocusCheckpointStore(now = { time })
        store.save("episodes:providerA:series1:episode", "episode-12")
        store.save("episodes:providerA:series1:season", "2")
        store.save("episodes:providerB:series1:episode", "episode-1")
        assertEquals("episode-12", store.restore("episodes:providerA:series1:episode"))
        assertEquals("2", store.restore("episodes:providerA:series1:season"))
        assertEquals("episode-1", store.restore("episodes:providerB:series1:episode"))
        store.clear("episodes:providerA:series1:episode")
        assertNull(store.restore("episodes:providerA:series1:episode"))
    }

    @Test fun oldFocusExpiresAndCannotJumpAfterLongAbsence() {
        var time = 100L
        val store = FocusCheckpointStore(now = { time }, maxAgeMillis = 1_000L)
        store.save("episodes:p:s:episode", "e7")
        time = 1_101L
        assertNull(store.restore("episodes:p:s:episode"))
        store.save("episodes:p:s:episode", "e8")
        time = 30L
        assertNull(store.restore("episodes:p:s:episode"))
    }

    @Test fun capsMemoryAndSkipsInvalidKeys() {
        val store = FocusCheckpointStore(maxItems = 2)
        store.save("episodes:p:s:episode", "e1")
        store.save("episodes:p:s:season", "2")
        store.save("episodes:p2:s:episode", "e9")
        assertNull(store.restore("episodes:p:s:episode"))
        assertEquals("2", store.restore("episodes:p:s:season"))
        store.save("episodes:invalid", "")
        store.save("", "e3")
        assertNull(store.restore("episodes:invalid"))
    }
}
