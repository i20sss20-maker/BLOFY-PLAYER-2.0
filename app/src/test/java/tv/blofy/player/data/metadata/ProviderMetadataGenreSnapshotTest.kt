package tv.blofy.player.data.metadata

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

/** Same persisted film genres for All Movies, specific categories and page-cache restore. */
@RunWith(RobolectricTestRunner::class)
@Config(manifest = Config.NONE, sdk = [28])
class ProviderMetadataGenreSnapshotTest {
    private fun detail(name: String, genres: List<String>) = ProviderMetadata.Metadata(
        kind = "movie", title = name, overview = null, rating = null,
        releaseDate = null, runtimeMinutes = null, genres = genres,
        posterUrl = null, backdropUrl = null, logoUrl = null,
        cast = emptyList(), crew = emptyList()
    )

    @Test fun sameContentHasIdenticalGenresAcrossCategoryAndAllMovies() {
        val context = RuntimeEnvironment.getApplication()
        val owner = "genre-batch-test"
        val first = "genre-batch-test:film-101"
        val second = "genre-batch-test:film-102"
        try {
            ProviderMetadataCache.write(context, owner, first, detail("Film one", listOf("Action", "Comedy")))
            ProviderMetadataCache.write(context, owner, second, detail("Film two", listOf("Drama")))
            val all = ProviderMetadataCache.readGenresForPage(context, listOf(first, second))
            val category = ProviderMetadataCache.readGenresForPage(context, listOf(second))
            assertEquals(listOf("Action", "Comedy"), all[first])
            assertEquals(all[second], category[second])
            assertEquals(2, all.size)
        } finally {
            ProviderMetadataCache.clearProvider(context, owner)
        }
    }

    @Test fun batchQueryDoesNotInventGenresWhenSourceHadNone() {
        val context = RuntimeEnvironment.getApplication()
        val owner = "genre-batch-empty"
        val key = "genre-batch-empty:film-101"
        try {
            ProviderMetadataCache.write(context, owner, key, detail("Unknown", emptyList()))
            assertFalse(ProviderMetadataCache.readGenresForPage(context, listOf(key)).containsKey(key))
            assertTrue(ProviderMetadataCache.readGenresForPage(context, emptyList()).isEmpty())
        } finally {
            ProviderMetadataCache.clearProvider(context, owner)
        }
    }

    @Test fun batchQueryRemainsBoundedAbove128ContentKeys() {
        val context = RuntimeEnvironment.getApplication()
        val owner = "genre-batch-130"
        try {
            val keys = (1..130).map { "$owner:$it" }
            keys.forEachIndexed { index, key ->
                ProviderMetadataCache.write(context, owner, key, detail("Film $index", listOf("Thriller")))
            }
            val map = ProviderMetadataCache.readGenresForPage(context, keys)
            assertEquals(130, map.size)
            assertEquals(listOf("Thriller"), map[keys.last()])
        } finally {
            ProviderMetadataCache.clearProvider(context, owner)
        }
    }
}
