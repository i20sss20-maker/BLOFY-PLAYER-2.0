package tv.blofy.player.ui.home

import android.app.Application
import androidx.room.Room
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import tv.blofy.player.data.local.BlofyDatabase
import tv.blofy.player.data.local.EpisodeEntity
import tv.blofy.player.data.local.StreamEntity
import tv.blofy.player.data.local.WatchStateEntity

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28], application = Application::class)
class HomeWatchHistoryTest {
    private lateinit var db: BlofyDatabase

    @Before fun setup() {
        db = Room.inMemoryDatabaseBuilder(RuntimeEnvironment.getApplication(), BlofyDatabase::class.java).build()
    }

    @After fun cleanup() = db.close()

    @Test fun olderWatchedMovieAppearsOutsideTheLatest320Titles(): Unit = runBlocking(Dispatchers.IO) {
        val dao = db.dao()
        val old = stream("old", "movie").copy(addedAt = 1L)
        dao.upsertStreams((1..340).map { stream("$it", "movie").copy(addedAt = 100L) } + old)
        val state = watch(old.key, "movie", 90_000L, updatedAt = 20L)
        dao.saveWatchState(state)

        assertFalse(dao.latestHomeStreams(PROVIDER, 320).contains(old))
        val history = HomeWatchHistory.load(dao, PROVIDER)
        assertEquals(listOf(old), history.continueItems)
        assertEquals(listOf(old), history.recentItems)
        assertEquals(state, history.watchStates[old.key])
    }

    @Test fun episodeHistoryResolvesLegacyParentIdAndKeepsNewestUnfinishedEpisode(): Unit = runBlocking(Dispatchers.IO) {
        val dao = db.dao()
        val series = stream("42", "series")
        dao.upsertStreams(listOf(series))
        val first = EpisodeEntity("$PROVIDER:episode:1", PROVIDER, "42.0", "1", 1, 1, "First")
        val second = first.copy(key = "$PROVIDER:episode:2", remoteId = "2", episode = 2)
        dao.upsertEpisodes(listOf(first, second))
        dao.saveWatchState(watch(first.key, "episode", 60_000L, updatedAt = 1L))
        val latest = watch(second.key, "episode", 120_000L, updatedAt = 2L)
        dao.saveWatchState(latest)

        val history = HomeWatchHistory.load(dao, PROVIDER)
        assertEquals(listOf(series), history.continueItems)
        assertEquals(listOf(series), history.recentItems)
        assertEquals(latest, history.watchStates[series.key])
        val forYou = SmartHomeEngine.build(dao, PROVIDER)
        assertEquals(listOf(series), forYou.continueItems)
        assertEquals("series", forYou.preferredKind)
    }

    @Test fun completionAndNewProgressAreReadOnTheNextVisibleRefresh(): Unit = runBlocking(Dispatchers.IO) {
        val dao = db.dao()
        val movie = stream("film", "movie")
        dao.upsertStreams(listOf(movie))
        dao.saveWatchState(watch(movie.key, "movie", 90_000L, updatedAt = 1L))
        assertEquals(listOf(movie), HomeWatchHistory.load(dao, PROVIDER).continueItems)

        dao.saveWatchState(watch(movie.key, "movie", 600_000L, updatedAt = 2L).copy(completed = true))
        val completed = HomeWatchHistory.load(dao, PROVIDER)
        assertTrue(completed.continueItems.isEmpty())
        assertEquals(listOf(movie), completed.recentItems)

        val resumed = watch(movie.key, "movie", 150_000L, updatedAt = 3L)
        dao.saveWatchState(resumed)
        assertEquals(resumed, HomeWatchHistory.load(dao, PROVIDER).watchStates[movie.key])
    }

    @Test fun missingAndCrossProviderRowsDoNotEnterHomeHistory(): Unit = runBlocking(Dispatchers.IO) {
        val dao = db.dao()
        val other = stream("foreign", "movie").copy(providerId = "other")
        dao.upsertStreams(listOf(other))
        dao.saveWatchState(watch(other.key, "movie", 90_000L, 1L))
        dao.saveWatchState(watch("$PROVIDER:episode:missing", "episode", 90_000L, 2L))
        val history = HomeWatchHistory.load(dao, PROVIDER)
        assertTrue(history.continueItems.isEmpty())
        assertTrue(history.recentItems.isEmpty())
    }

    private fun stream(id: String, kind: String) = StreamEntity("$PROVIDER:$kind:$id", PROVIDER,
        id, null, kind, "$kind $id")

    private fun watch(key: String, kind: String, positionMs: Long, updatedAt: Long) =
        WatchStateEntity(key, PROVIDER, kind, positionMs, 600_000L, updatedAt = updatedAt)

    private companion object { const val PROVIDER = "provider" }
}
