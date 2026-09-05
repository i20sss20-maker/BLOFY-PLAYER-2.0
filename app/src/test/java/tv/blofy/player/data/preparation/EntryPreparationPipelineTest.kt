package tv.blofy.player.data.preparation

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import org.junit.Assert.*
import org.junit.Test

class EntryPreparationPipelineTest {
    @Test fun reportsCompleteOnlyAfterAllLocalWrites() = runBlocking {
        val events = mutableListOf<String>()
        EntryPreparationPipeline.run(
            home = { events += "home" }, search = { events += "search" },
            commit = { events += "commit" }, progress = { events += "$it" })
        assertEquals(listOf("32", "home", "70", "search", "95", "commit", "100"), events)
    }

    @Test fun failedWriteNeverReportsComplete() = runBlocking {
        for (failed in listOf("home", "search", "commit")) {
            val steps = mutableListOf<String>()
            suspend fun step(name: String) { steps += name; if (name == failed) error("disk write failed") }
            val result = runCatching {
                EntryPreparationPipeline.run({ step("home") }, { step("search") },
                    { step("commit") }, { steps += "$it" })
            }
            assertTrue(result.isFailure)
            assertFalse(steps.contains("100"))
            if (failed != "commit") assertFalse(steps.contains("commit"))
        }
    }

    @Test fun cancellationStopsPreparationBeforeCommit() = runBlocking {
        var committed = false
        val result = runCatching {
            EntryPreparationPipeline.run({}, { throw CancellationException("Back") },
                { committed = true }, {})
        }
        assertTrue(result.exceptionOrNull() is CancellationException)
        assertFalse(committed)
    }

    @Test fun childTimeoutShowsRetryInsteadOfDisappearingAsCancellation() = runBlocking {
        var timeout = 0
        var failed = 0
        CatalogLoadAttempt.run({ timeout++ }, { failed++ }) {
            withTimeout(1L) { awaitCancellation() }
        }
        assertEquals(1, timeout)
        assertEquals(0, failed)
    }

    @Test fun parentTimeoutDoesNotShowAnErrorOnAnAbandonedScreen() = runBlocking {
        var errors = 0
        val result = runCatching {
            withTimeout(1L) {
                CatalogLoadAttempt.run({ errors++ }, { errors++ }) { awaitCancellation() }
            }
        }
        assertTrue(result.exceptionOrNull() is TimeoutCancellationException)
        assertEquals(0, errors)
    }

    @Test fun backCancellationIsNotConvertedIntoFailure() = runBlocking {
        var errors = 0
        val result = runCatching {
            CatalogLoadAttempt.run({ errors++ }, { errors++ }) { throw CancellationException("Back") }
        }
        assertTrue(result.exceptionOrNull() is CancellationException)
        assertEquals(0, errors)
    }

    @Test fun ordinaryFailureShowsOneErrorAndAllowsAnotherAttempt() = runBlocking {
        var failures = 0
        var success = false
        CatalogLoadAttempt.run({ fail("Not a timeout") }, { failures++ }) { error("storage") }
        CatalogLoadAttempt.run({ fail("Not a timeout") }, { failures++ }) { success = true }
        assertEquals(1, failures)
        assertTrue(success)
    }
}
