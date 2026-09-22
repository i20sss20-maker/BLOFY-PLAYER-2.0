package tv.blofy.player.ui.library

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
import tv.blofy.player.data.local.InMemoryKeystoreApplication
import tv.blofy.player.data.local.StreamEntity
import tv.blofy.player.data.local.WatchStateEntity
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.Executor

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28], application = InMemoryKeystoreApplication::class)
class ContinueWatchingLoadTest {
    private lateinit var db: BlofyDatabase
    private val queries = CopyOnWriteArrayList<String>()

    @Before fun setup() {
        db = Room.inMemoryDatabaseBuilder(RuntimeEnvironment.getApplication(), BlofyDatabase::class.java)
            .setQueryCallback({ sql, _ -> queries.add(sql) }, Executor { it.run() }).build()
    }
    @After fun cleanup() { db.close() }

    private fun series(id: String, provider: String = "p") = StreamEntity("$provider:series:$id", provider, id, null, "series", "Series $id")
    private fun episode(id: String, seriesId: String, provider: String = "p") =
        EpisodeEntity("$provider:episode:$id", provider, seriesId, id, 1, 2, "Second episode")
    private fun state(episode: EpisodeEntity) = WatchStateEntity(episode.key, episode.providerId, "episode", 42_000, 100_000)

    @Test fun resolvesSavedEpisodesWithoutReadingTheWholeSeriesCatalog(): Unit = runBlocking(Dispatchers.IO) {
        db.dao().upsertStreams((1..12_000).map { series(it.toString()) })
        val saved = episode("7", "11999.00")
        db.dao().upsertEpisodes(listOf(saved))
        queries.clear()
        val item = ContinueWatchingResolver.load(db.dao(), "p", listOf(state(saved))).single() as ContinueWatchingEntry.EpisodeEntry
        assertEquals("Series 11999", item.parentSeries?.name)
        assertEquals(42_000L, item.state.positionMs)
        val streamReads = queries.filter { it.startsWith("SELECT * FROM streams") }
        assertTrue(streamReads.isNotEmpty())
        assertTrue("Parent reads must be bounded identity queries: $streamReads", streamReads.all { it.contains("remoteId =") && it.contains("LIMIT 1") })
        val plan = db.openHelper.readableDatabase.query("EXPLAIN QUERY PLAN SELECT * FROM streams WHERE providerId='p' AND kind='series' AND remoteId='11999' LIMIT 1").use {
            buildString { while (it.moveToNext()) append(it.getString(3)) }
        }
        assertTrue(plan.contains("index_streams_providerId_kind_remoteId"))
    }

    @Test fun legacyDecimalParentsAndMissingParentsRemainUsable(): Unit = runBlocking(Dispatchers.IO) {
        val parent = series("42.000")
        val numeric = episode("1", "42")
        val missing = episode("2", "missing")
        db.dao().upsertStreams(listOf(parent, series("42.01"), series("42", "other")))
        db.dao().upsertEpisodes(listOf(numeric, missing))
        val result = ContinueWatchingResolver.load(db.dao(), "p", listOf(state(missing), state(numeric)))
            .map { it as ContinueWatchingEntry.EpisodeEntry }
        assertEquals(listOf(missing.key, numeric.key), result.map { it.episode.key })
        assertNull(result[0].parentSeries)
        assertEquals(parent, result[1].parentSeries)
    }

    @Test fun ignoresStatesBelongingToAnotherProvider(): Unit = runBlocking(Dispatchers.IO) {
        val foreign = episode("1", "42", "other")
        db.dao().upsertEpisodes(listOf(foreign))
        db.dao().upsertStreams(listOf(series("42", "other")))
        assertTrue(ContinueWatchingResolver.load(db.dao(), "p", listOf(state(foreign))).isEmpty())
    }
}
