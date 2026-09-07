package tv.blofy.player.data.local

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

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28], application = Application::class)
class CatalogRefreshPersistenceTest {
    private lateinit var db: BlofyDatabase
    private val original = ProviderEntity("saved", "Saved", "https://fixture.example.test", "u", "p")
    private val savedMovie get() = stream(original.id, "movie", 1).copy(favorite = true)
    private val resume = WatchStateEntity("saved:movie:1", original.id, "movie", 45_000L, 180_000L, updatedAt = 123_456L)
    private val activation = ActivationEntity("BLOFY-TEST-ABCD", "123456", activated = true)

    @Before fun setup(): Unit = runBlocking(Dispatchers.IO) {
        db = Room.inMemoryDatabaseBuilder(RuntimeEnvironment.getApplication(), BlofyDatabase::class.java).build()
        db.dao().upsertProviderStored(original)
        catalog(original.id, live = 5, movies = 1_000, series = 5)
        db.dao().setFavorite(savedMovie.key, true)
        db.dao().saveWatchState(resume)
        db.dao().upsertActivation(activation)
    }

    @After fun cleanup() = db.close()

    private fun stream(providerId: String, kind: String, id: Int) = StreamEntity(
        "$providerId:$kind:$id", providerId, "$id", null, kind, "Saved Item $id"
    )

    private suspend fun catalog(providerId: String, live: Int, movies: Int, series: Int) {
        for ((kind, count) in listOf("live" to live, "movie" to movies, "series" to series)) {
            db.dao().replaceCatalog(providerId, kind, emptyList(), (1..count).map { stream(providerId, kind, it) })
        }
    }

    private suspend fun assertKnownGoodCatalog() {
        val dao = db.dao()
        assertEquals(5, dao.catalogCountAll(original.id, "live"))
        assertEquals(1_000, dao.catalogCountAll(original.id, "movie"))
        assertEquals(5, dao.catalogCountAll(original.id, "series"))
        assertEquals(savedMovie, dao.stream(savedMovie.key))
        assertEquals(resume, dao.watchState(savedMovie.key))
        assertEquals(activation, dao.activation())
        assertEquals(original, dao.provider(original.id))
        assertEquals(10, dao.searchStreamsFts(original.id, "Saved*", 10).size)
    }

    @Test fun missingSectionRejectsPromotionWithoutDeletingSavedRows(): Unit = runBlocking(Dispatchers.IO) {
        catalog("staged", live = 0, movies = 1_000, series = 5)
        val failure = runCatching { db.dao().promoteStagedRefresh("staged", original) }.exceptionOrNull()
        assertTrue(failure is IllegalStateException)
        assertKnownGoodCatalog()
        db.dao().discardStagedCatalog("staged")
        assertKnownGoodCatalog()
    }

    @Test fun validButTruncatedLargeSectionRejectsPromotion(): Unit = runBlocking(Dispatchers.IO) {
        catalog("staged", live = 5, movies = 600, series = 5)
        val failure = runCatching { db.dao().promoteStagedRefresh("staged", original) }.exceptionOrNull()
        assertTrue(failure is IllegalStateException)
        assertKnownGoodCatalog()
        assertEquals(610, db.dao().streamCountForProvider("staged"))
    }

    @Test fun healthyRefreshPromotesAtomicallyAndKeepsUserState(): Unit = runBlocking(Dispatchers.IO) {
        catalog("staged", live = 6, movies = 1_100, series = 6)
        db.dao().promoteStagedRefresh("staged", original)
        assertEquals(1_112, db.dao().streamCountForProvider(original.id))
        assertEquals(0, db.dao().streamCountForProvider("staged"))
        assertEquals(savedMovie, db.dao().stream(savedMovie.key))
        assertEquals(resume, db.dao().watchState(savedMovie.key))
        assertEquals(activation, db.dao().activation())
        assertEquals(10, db.dao().searchStreamsFts(original.id, "Saved*", 10).size)
    }
}
