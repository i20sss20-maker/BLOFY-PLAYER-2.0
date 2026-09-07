package tv.blofy.player.ui.player

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import org.junit.Assert.*
import org.junit.Test
import tv.blofy.player.data.ResumeStateWriter
import tv.blofy.player.data.ResumeWriteRequest

class EpisodeTransitionResumeTest {
    @Test fun manualNextAndPreviousPersistDepartingSnapshotAfterPlayerMovesOn() = runBlocking {
        for (delta in listOf(-1, 1)) {
            val owner = CoroutineScope(SupervisorJob() + Dispatchers.Default)
            val allowWrite = CompletableDeferred<Unit>()
            val written = CompletableDeferred<ResumeWriteRequest>()
            val writer = ResumeStateWriter(owner) { request -> allowWrite.await(); written.complete(request) }
            var contentKey = "series:episode:2"
            var position = 734_000L
            try {
                transitionEpisode(
                    automatic = false,
                    saveResume = {
                        assertTrue(writer.enqueue(ResumeWriteRequest(contentKey, "provider", "episode", position, 1_800_000L)))
                    },
                    markCompleted = { fail("Manual navigation must not mark an unfinished episode completed") },
                ) {
                    contentKey = "series:episode:${2 + delta}"
                    position = 0L
                }
                assertEquals("series:episode:${2 + delta}", contentKey)
                assertEquals(0L, position)
                assertFalse(written.isCompleted)
                allowWrite.complete(Unit)
                assertEquals(
                    ResumeWriteRequest("series:episode:2", "provider", "episode", 734_000L, 1_800_000L),
                    withTimeout(2_000L) { written.await() },
                )
            } finally { owner.cancel() }
        }
    }

    @Test fun automaticAdvanceRetainsCompletionOfTheDepartingEpisode() {
        var contentKey = "series:episode:2"
        var completedKey: String? = null
        transitionEpisode(
            automatic = true,
            saveResume = { fail("Automatic completion must not be overwritten by a partial resume snapshot") },
            markCompleted = { completedKey = contentKey },
        ) { contentKey = "series:episode:3" }
        assertEquals("series:episode:2", completedKey)
        assertEquals("series:episode:3", contentKey)
    }
}
