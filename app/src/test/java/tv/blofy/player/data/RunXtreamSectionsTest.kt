package tv.blofy.player.data

import java.io.EOFException
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.fail
import org.junit.Test

class RunXtreamSectionsTest {
    @Test
    fun interruptedSectionIsRetriedBeforeAdvancing() = runBlocking {
        var attempts = 0
        var followingSectionRuns = 0
        val result = runXtreamSections(
            listOf<suspend () -> Unit>(
                {
                    attempts++
                    if (attempts < 3) throw EOFException("unexpected end of stream")
                },
                { followingSectionRuns++ }
            )
        )

        assertEquals(3, attempts)
        assertEquals(1, followingSectionRuns)
        assertEquals(2, result.successCount)
        assertEquals(0, result.failureCount)
    }

    @Test
    fun wrappedNetworkFailureIsRetried() = runBlocking {
        var attempts = 0
        val result = runXtreamSections(
            listOf<suspend () -> Unit> {
                attempts++
                if (attempts == 1) throw IllegalStateException(
                    "JSON was truncated", EOFException("unexpected end of stream")
                )
            }
        )

        assertEquals(2, attempts)
        assertEquals(1, result.successCount)
    }

    @Test
    fun failingMovieSectionIsReportedWithoutLosingWorkingSections() = runBlocking {
        val result = runXtreamSections(
            listOf<suspend () -> Unit>(
                { /* live downloaded */ },
                { throw IllegalArgumentException("provider's movie section invalid") },
                { /* series downloaded */ }
            )
        )
        assertEquals(2, result.successCount)
        assertEquals(1, result.failureCount)
        assertEquals(listOf(1), result.failedSectionIndices)
        assertEquals(
            "الأفلام",
            PlaylistSyncResult(5, 1, listOf(PlaylistSyncStage.MOVIES)).failedSectionNames()
        )
    }

    @Test
    fun invalidProviderFailureIsNotRetried() = runBlocking {
        var attempts = 0
        try {
            runXtreamSections(listOf<suspend () -> Unit> {
                attempts++
                throw IllegalArgumentException("invalid provider credentials")
            })
            fail("Non-network errors must not be retried")
        } catch (_: IllegalArgumentException) {
            assertEquals(1, attempts)
        }
    }
}
