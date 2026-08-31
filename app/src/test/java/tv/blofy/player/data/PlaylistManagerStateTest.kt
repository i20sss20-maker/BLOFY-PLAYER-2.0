package tv.blofy.player.data

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import tv.blofy.player.data.local.StreamEntity

class PlaylistManagerStateTest {
    @Test
    fun preservesFavoriteAndLockAcrossLegacyDecimalIdMigration() {
        listOf("live", "movie", "series").forEach { kind ->
            val previous = stream(id = "14.0", kind = kind, favorite = true, locked = true)
            val fresh = stream(id = "14", kind = kind, source = "https://provider.example/$kind/14")

            val migrated = PreviousStreamFlags(listOf(previous)).applyTo(listOf(fresh)).single()

            assertTrue(migrated.favorite)
            assertTrue(migrated.locked)
            assertEquals("14", migrated.remoteId)
            assertEquals("p1:$kind:14", migrated.key)
            assertEquals("https://provider.example/$kind/14", migrated.directSource)
        }
    }

    @Test
    fun canRecoverFlagsFromLegacyKeyWhenStoredRemoteIdWasAlreadyDifferent() {
        val previous = stream(id = "other", keyId = "14.0", favorite = true)
        val fresh = stream(id = "14")

        val migrated = PreviousStreamFlags(listOf(previous)).applyTo(listOf(fresh)).single()

        assertTrue(migrated.favorite)
    }

    @Test
    fun leadingZeroIdentifierRemainsDistinctAndFreshOrderIsStable() {
        val previous = listOf(
            stream(id = "0014", favorite = true),
            stream(id = "14.0", locked = true)
        )
        val fresh = listOf(
            stream(id = "14", name = "First"),
            stream(id = "0014", name = "Second")
        )

        val migrated = PreviousStreamFlags(previous).applyTo(fresh)

        assertEquals(listOf("First", "Second"), migrated.map { it.name })
        assertFalse(migrated[0].favorite)
        assertTrue(migrated[0].locked)
        assertTrue(migrated[1].favorite)
        assertFalse(migrated[1].locked)
        assertEquals("0014", PreviousStreamFlags.legacyCompatibleId("0014"))
        assertEquals("14", PreviousStreamFlags.legacyCompatibleId("14.0"))
    }

    @Test
    fun neverCarriesFlagsAcrossContentKinds() {
        val previousMovie = stream(id = "14.0", kind = "movie", favorite = true)
        val freshLive = stream(id = "14", kind = "live")

        val migrated = PreviousStreamFlags(listOf(previousMovie)).applyTo(listOf(freshLive)).single()

        assertFalse(migrated.favorite)
    }

    @Test
    fun replacementPolicyPreservesExistingCatalogOnEmptyOrUnparseablePayload() {
        assertFalse(
            CatalogReplacementPolicy.shouldReplace(
                previousStreamCount = 12,
                sourceCategoryCount = 0,
                parsedCategoryCount = 0,
                sourceStreamCount = 0,
                parsedStreamCount = 0
            )
        )
        assertFalse(
            CatalogReplacementPolicy.shouldReplace(
                previousStreamCount = 0,
                sourceCategoryCount = 1,
                parsedCategoryCount = 0,
                sourceStreamCount = 1,
                parsedStreamCount = 0
            )
        )
        assertTrue(
            CatalogReplacementPolicy.shouldReplace(
                previousStreamCount = 12,
                sourceCategoryCount = 1,
                parsedCategoryCount = 1,
                sourceStreamCount = 1,
                parsedStreamCount = 1
            )
        )
    }

    @Test
    fun oneFailedXtreamSectionDoesNotBlockTheRemainingSections() = runBlocking {
        val attempted = mutableListOf<String>()

        val result = runXtreamSections(
            listOf(
                suspend {
                    attempted += "live"
                    error("live unavailable")
                },
                suspend { attempted += "movie" },
                suspend { attempted += "series" }
            )
        )

        assertEquals(listOf("live", "movie", "series"), attempted)
        assertEquals(2, result.successCount)
        assertEquals(1, result.failureCount)
    }

    @Test
    fun allFailedXtreamSectionsPropagateTheFirstFailure() = runBlocking {
        val failure = runCatching {
            runXtreamSections(
                listOf(
                    suspend { throw IllegalStateException("live") },
                    suspend { throw IllegalArgumentException("movie") },
                    suspend { throw UnsupportedOperationException("series") }
                )
            )
        }.exceptionOrNull()

        assertTrue(failure is IllegalStateException)
        assertEquals("live", failure?.message)
        assertEquals(2, failure?.suppressed?.size)
    }

    @Test
    fun cancellationStopsXtreamSectionSyncImmediately() = runBlocking {
        var laterSectionAttempted = false
        val cancellation = runCatching {
            runXtreamSections(
                listOf(
                    suspend { throw CancellationException("cancelled") },
                    suspend { laterSectionAttempted = true }
                )
            )
        }.exceptionOrNull()

        assertTrue(cancellation is CancellationException)
        assertFalse(laterSectionAttempted)
    }

    private fun stream(
        id: String,
        keyId: String = id,
        kind: String = "live",
        name: String = id,
        source: String? = null,
        favorite: Boolean = false,
        locked: Boolean = false
    ) = StreamEntity(
        key = "p1:$kind:$keyId",
        providerId = "p1",
        remoteId = id,
        categoryId = "category",
        kind = kind,
        name = name,
        directSource = source,
        favorite = favorite,
        locked = locked
    )
}
