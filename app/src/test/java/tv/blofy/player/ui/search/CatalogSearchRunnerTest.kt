package tv.blofy.player.ui.search

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import kotlinx.coroutines.yield
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class CatalogSearchRunnerTest {
    @Test fun changingQueryCancelsTheRunningSearchBeforeItCanRender() = runBlocking {
        withTimeout(5_000) {
            val started = CompletableDeferred<Unit>()
            val cancelled = CompletableDeferred<Unit>()
            val rendered = CompletableDeferred<Unit>()
            val results = mutableListOf<String>()
            val runner = CatalogSearchRunner(this) { query, _ ->
                if (query == "old") {
                    started.complete(Unit)
                    try { awaitCancellation() } finally { cancelled.complete(Unit) }
                }
                results += query
                rendered.complete(Unit)
            }

            runner.submit("old", true)
            started.await()
            runner.submit(" new ", true)
            cancelled.await()
            rendered.await()
            assertEquals(listOf("new"), results)
            runner.cancel()
        }
    }

    @Test fun submittingTheSameQueryCancelsPendingAutoSearchAndMovesFocusOnlyOnce() = runBlocking {
        withTimeout(5_000) {
            val started = CompletableDeferred<Unit>()
            val cancelled = CompletableDeferred<Unit>()
            val submitted = CompletableDeferred<Unit>()
            val focusChanges = mutableListOf<Boolean>()
            val runner = CatalogSearchRunner(this) { query, moveFocus ->
                assertEquals("movie", query)
                if (!moveFocus) {
                    started.complete(Unit)
                    try { awaitCancellation() } finally { cancelled.complete(Unit) }
                }
                focusChanges += moveFocus
                submitted.complete(Unit)
            }

            runner.submit("movie", false)
            started.await()
            runner.submit("movie", true)
            cancelled.await()
            submitted.await()
            assertEquals(listOf(true), focusChanges)
            runner.cancel()
        }
    }

    @Test fun clearingTheInputCancelsAnActiveSearchWithoutLaunchingAnother() = runBlocking {
        withTimeout(5_000) {
            val started = CompletableDeferred<Unit>()
            val cancelled = CompletableDeferred<Unit>()
            var calls = 0
            val runner = CatalogSearchRunner(this) { _, _ ->
                calls++
                started.complete(Unit)
                try { awaitCancellation() } finally { cancelled.complete(Unit) }
            }
            runner.submit("channel", true)
            started.await()
            runner.submit("  ", false)
            cancelled.await()
            yield()
            assertEquals(1, calls)
        }
    }

    @Test fun destroyingTheOwnerCancelsTheSearchWithItsScope() = runBlocking {
        withTimeout(5_000) {
            val owner = SupervisorJob(coroutineContext[Job])
            val started = CompletableDeferred<Unit>()
            val cancelled = CompletableDeferred<Unit>()
            val runner = CatalogSearchRunner(CoroutineScope(coroutineContext + owner)) { _, _ ->
                started.complete(Unit)
                try { awaitCancellation() } finally { cancelled.complete(Unit) }
            }
            runner.submit("series", true)
            started.await()
            owner.cancel()
            cancelled.await()
            assertTrue(owner.isCancelled)
        }
    }

    @Test fun immediateSubmitReplacesDebounceWithoutDuplicateDatabaseWork() = runBlocking {
        withTimeout(5_000) {
            val rendered = CompletableDeferred<Unit>()
            val results = mutableListOf<String>()
            val runner = CatalogSearchRunner(this) { query, _ ->
                results += query
                rendered.complete(Unit)
            }
            runner.submit("m", false)
            runner.submit("mo", false)
            runner.submit("movie", true)
            rendered.await()
            assertEquals(listOf("movie"), results)
            runner.cancel()
        }
    }
}
