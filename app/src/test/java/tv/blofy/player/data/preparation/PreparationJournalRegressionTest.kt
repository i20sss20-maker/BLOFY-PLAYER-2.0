package tv.blofy.player.data.preparation

import android.app.Application
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28], application = Application::class)
class PreparationJournalRegressionTest {
    private val app get() = RuntimeEnvironment.getApplication()
    @Before fun setup() { app.deleteDatabase("blofy-preparation-v1.db") }
    @After fun cleanup() { app.deleteDatabase("blofy-preparation-v1.db") }

    @Test fun completedAndPendingUnitsSurviveDatabaseReopen() {
        PreparationJournal(app).use { j ->
            j.begin("provider", "generation-1")
            j.enqueue("provider", "detail", "movie-1")
            j.enqueue("provider", "detail", "series-2")
            j.complete("provider", "detail", "movie-1")
        }
        PreparationJournal(app).use { j ->
            j.begin("provider", "generation-1")
            assertEquals(1L to 2L, j.counts("provider", "detail"))
            assertTrue(j.done("provider", "detail", "movie-1"))
            assertFalse(j.done("provider", "detail", "series-2"))
        }
    }

    @Test fun repeatedPlanningDoesNotDuplicateOrResetCompletedUnit() {
        PreparationJournal(app).use { j ->
            j.begin("p", "g")
            j.enqueue("p", "detail", "one")
            j.complete("p", "detail", "one")
            repeat(5) { j.enqueue("p", "detail", "one") }
            assertEquals(1L to 1L, j.counts("p", "detail"))
        }
    }

    @Test fun newGenerationInvalidatesOnlyItsOwnProvider() {
        PreparationJournal(app).use { j ->
            listOf("p", "other").forEach { p ->
                j.begin(p, "old")
                j.enqueue(p, "detail", "one")
                j.complete(p, "detail", "one")
            }
            j.begin("p", "new")
            assertEquals(0L to 0L, j.counts("p", "detail"))
            assertEquals(1L to 1L, j.counts("other", "detail"))
        }
    }

    @Test fun missingDiskImageCanBeReopenedForRetry() {
        PreparationJournal(app).use { j ->
            j.begin("p", "g")
            j.enqueue("p", "art", "image", "https://example.invalid/image.jpg")
            j.complete("p", "art", "image")
            j.reopen("p", "art", "image")
            assertFalse(j.done("p", "art", "image"))
            assertEquals(0L to 1L, j.counts("p", "art"))
        }
    }

    @Test fun failedFirstImageDoesNotTrapPaginationOnSamePage() {
        PreparationJournal(app).use { j ->
            j.begin("p", "g")
            listOf("a", "b", "c").forEach { j.enqueue("p", "art", it, "https://example.invalid/$it") }
            val first = j.imagePage("p", "", 2)
            assertEquals(listOf("a", "b"), first.map { it.first })
            j.complete("p", "art", "b")
            val second = j.imagePage("p", first.last().first, 2)
            assertEquals(listOf("c"), second.map { it.first })
            assertTrue(j.imagePage("p", second.last().first, 2).isEmpty())
            assertEquals(1L to 3L, j.counts("p", "art"))
        }
    }

    @Test fun detailAndArtworkCountsAreSeparate() {
        PreparationJournal(app).use { j ->
            j.begin("p", "g")
            j.enqueue("p", "detail", "same-key")
            j.enqueue("p", "art", "same-key")
            j.complete("p", "detail", "same-key")
            assertEquals(1L to 1L, j.counts("p", "detail"))
            assertEquals(0L to 1L, j.counts("p", "art"))
        }
    }

    @Test(expected = IllegalStateException::class)
    fun absentUnitCannotBeReportedSaved() {
        PreparationJournal(app).use { it.complete("p", "detail", "never-enqueued") }
    }

    @Test fun hashIsStableAndSeparatesDifferentSources() {
        assertEquals(PreparationJournal.hash("same"), PreparationJournal.hash("same"))
        assertNotEquals(PreparationJournal.hash("same"), PreparationJournal.hash("different"))
        assertTrue(PreparationJournal.hash("same").matches(Regex("[0-9a-f]{64}")))
    }
}
