package tv.blofy.player.ui.search

import android.content.Context
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28])
class RecentSearchStoreTest {
    private lateinit var context: Context

    @Before
    fun setUp() {
        context = RuntimeEnvironment.getApplication().applicationContext
        RecentSearchStore.clear(context)
    }

    @After
    fun tearDown() {
        RecentSearchStore.clear(context)
    }

    @Test
    fun record_normalizesWhitespace_andIgnoresTooShortQueries() {
        RecentSearchStore.record(context, "  Al   Hilal   match  ")
        RecentSearchStore.record(context, " a ")

        assertEquals(listOf("Al Hilal match"), RecentSearchStore.recent(context))
    }

    @Test
    fun record_movesExistingQueryToFront_withoutCaseInsensitiveDuplicates() {
        RecentSearchStore.record(context, "Movies")
        RecentSearchStore.record(context, "Series")
        RecentSearchStore.record(context, "movies")

        assertEquals(listOf("movies", "Series"), RecentSearchStore.recent(context))
    }

    @Test
    fun record_keepsOnlyEightMostRecentQueries() {
        (1..10).forEach { RecentSearchStore.record(context, "query $it") }

        assertEquals(
            listOf("query 10", "query 9", "query 8", "query 7", "query 6", "query 5", "query 4", "query 3"),
            RecentSearchStore.recent(context)
        )
    }

    @Test
    fun record_capsStoredQueryLengthAt120Characters() {
        RecentSearchStore.record(context, "x".repeat(160))

        val stored = RecentSearchStore.recent(context).single()
        assertEquals(120, stored.length)
        assertTrue(stored.all { it == 'x' })
    }

    @Test
    fun clear_removesAllRecentQueries() {
        RecentSearchStore.record(context, "live channels")
        RecentSearchStore.record(context, "new movies")

        RecentSearchStore.clear(context)

        assertTrue(RecentSearchStore.recent(context).isEmpty())
    }
}
