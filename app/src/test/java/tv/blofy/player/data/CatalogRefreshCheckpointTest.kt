package tv.blofy.player.data

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
import tv.blofy.player.data.local.ProviderEntity
import tv.blofy.player.data.local.StreamEntity
import java.util.UUID

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28], application = tv.blofy.player.data.local.InMemoryKeystoreApplication::class)
class CatalogRefreshCheckpointTest {
    private val app get() = RuntimeEnvironment.getApplication()
    private lateinit var db: BlofyDatabase
    private lateinit var source: ProviderEntity

    @Before fun setUp(): Unit = runBlocking(Dispatchers.IO) {
        db = Room.inMemoryDatabaseBuilder(app, BlofyDatabase::class.java).build()
        source = ProviderEntity(UUID.randomUUID().toString(), "Main", "https://fixtures.example.test", "u", "p")
        db.dao().upsertProviderStored(source)
        db.dao().replaceCatalog(source.id, "live", emptyList(), listOf(item(source.id, "live", 1)))
    }

    @After fun tearDown() { db.close() }

    private fun item(owner: String, kind: String, id: Int) =
        StreamEntity("$owner:$kind:$id", owner, id.toString(), null, kind, "Item $id")

    @Test fun completedSectionsResumeAndPartialSectionsAreCleared(): Unit = runBlocking(Dispatchers.IO) {
        val dao = db.dao()
        val checkpoint = CatalogRefreshCheckpoint(app, source.id)
        val first = checkpoint.prepare(source, dao)
        dao.replaceCatalog(first.stagedId, "live", emptyList(), listOf(item(first.stagedId, "live", 10)))
        checkpoint.completed(first, "live", dao)
        dao.replaceCatalog(first.stagedId, "movie", emptyList(), listOf(item(first.stagedId, "movie", 30)))

        val resumed = checkpoint.prepare(source, dao)
        assertEquals(first.stagedId, resumed.stagedId)
        assertEquals(setOf("live"), resumed.completed)
        assertEquals(1, dao.catalogCountAll(first.stagedId, "live"))
        assertEquals(0, dao.catalogCountAll(first.stagedId, "movie"))
        // An unfinished background refresh must not touch the customer's committed rows.
        assertNotNull(dao.stream(item(source.id, "live", 1).key))
        assertNull(dao.stream(item(source.id, "live", 10).key))
    }

    @Test fun credentialChangeDiscardsOldCandidateAndStartsNewStage(): Unit = runBlocking(Dispatchers.IO) {
        val dao = db.dao()
        val checkpoint = CatalogRefreshCheckpoint(app, source.id)
        val first = checkpoint.prepare(source, dao)
        dao.replaceCatalog(first.stagedId, "live", emptyList(), listOf(item(first.stagedId, "live", 99)))
        checkpoint.completed(first, "live", dao)
        val newer = checkpoint.prepare(source.copy(password = "new-secret"), dao)

        assertNotEquals(first.stagedId, newer.stagedId)
        assertTrue(newer.completed.isEmpty())
        assertEquals(0, dao.catalogCountAll(first.stagedId, "live"))
        assertNotNull(dao.stream(item(source.id, "live", 1).key))
        assertNotEquals(
            CatalogRefreshCheckpoint.fingerprint(source),
            CatalogRefreshCheckpoint.fingerprint(source.copy(password = "new-secret"))
        )
    }

    @Test fun validatedEmptySectionIsRememberedAcrossRuns(): Unit = runBlocking(Dispatchers.IO) {
        val dao = db.dao()
        val checkpoint = CatalogRefreshCheckpoint(app, source.id)
        val first = checkpoint.prepare(source, dao)
        checkpoint.completed(first, "series", dao)
        val resumed = checkpoint.prepare(source, dao)
        assertTrue("series" in resumed.completed)
        checkpoint.discard(resumed, dao)
        val fresh = checkpoint.prepare(source, dao)
        assertNotEquals(resumed.stagedId, fresh.stagedId)
        assertTrue(fresh.completed.isEmpty())
    }

    @Test fun corruptedStagePreferenceCannotDeleteRealPlaylist(): Unit = runBlocking(Dispatchers.IO) {
        val prefs = app.getSharedPreferences("blofy_background_catalog_checkpoint_v1", 0)
        assertTrue(prefs.edit().putString("${source.id}:stage", source.id).commit())
        val checkpoint = CatalogRefreshCheckpoint(app, source.id)
        val recovered = checkpoint.prepare(source, db.dao())
        assertNotEquals(source.id, recovered.stagedId)
        assertTrue(recovered.stagedId.startsWith("blofy-refresh-stage-"))
        assertNotNull(db.dao().provider(source.id))
        assertNotNull(db.dao().stream(item(source.id, "live", 1).key))
    }

    @Test fun tamperedRowCountInvalidatesCompletedSection(): Unit = runBlocking(Dispatchers.IO) {
        val dao = db.dao()
        val checkpoint = CatalogRefreshCheckpoint(app, source.id)
        val first = checkpoint.prepare(source, dao)
        dao.replaceCatalog(first.stagedId, "movie", emptyList(), listOf(item(first.stagedId, "movie", 3)))
        checkpoint.completed(first, "movie", dao)
        dao.replaceCatalog(first.stagedId, "movie", emptyList(), emptyList())
        val resumed = checkpoint.prepare(source, dao)
        assertFalse("movie" in resumed.completed)
    }
}
