package tv.blofy.player.data

import android.app.Application
import androidx.room.Room
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import tv.blofy.player.data.local.BlofyDatabase
import tv.blofy.player.data.local.StreamEntity

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28], application = Application::class)
class ContentRepositorySearchTest {
    private lateinit var db: BlofyDatabase

    @Before fun setup() {
        db = Room.inMemoryDatabaseBuilder(RuntimeEnvironment.getApplication(), BlofyDatabase::class.java).build()
    }

    @After fun cleanup() = db.close()

    @Test fun normalizedArabicMatchesCannotBeCrowdedOutByAnotherKind(): Unit = runBlocking(Dispatchers.IO) {
        val dao = db.dao()
        val repository = ContentRepository(dao)
        for (kind in listOf("live", "movie", "series")) {
            val competingKind = if (kind == "live") "movie" else "live"
            val providerId = "provider-$kind"
            // These rows sort before the requested title and used to consume the global FTS
            // limit before searchKind applied its filter. Raw LIKE cannot match أ with ا.
            dao.replaceCatalog(providerId, competingKind, emptyList(), (1..650).map { id ->
                StreamEntity("$providerId:$competingKind:$id", providerId, "$id", null,
                    competingKind, "A $id", genre = "أحمد")
            })
            val target = StreamEntity("$providerId:$kind:target", providerId, "target", null,
                kind, "أحمد")
            dao.replaceCatalog(providerId, kind, emptyList(), listOf(target))

            assertEquals(listOf(target), repository.searchKind(providerId, kind, "احمد", 120))
        }
    }

    @Test fun kindAndProviderFiltersApplyBeforeTheRequestedLimit(): Unit = runBlocking(Dispatchers.IO) {
        val dao = db.dao()
        for (providerId in listOf("first", "second")) {
            for (kind in listOf("live", "movie", "series")) {
                dao.replaceCatalog(providerId, kind, emptyList(), (1..30).map { id ->
                    StreamEntity("$providerId:$kind:$id", providerId, "$id", null, kind, "Item $id")
                })
            }
        }
        val results = ContentRepository(dao).searchKind("second", "series", "Item", 5)
        assertEquals(5, results.size)
        assertEquals(setOf("second"), results.map { it.providerId }.toSet())
        assertEquals(setOf("series"), results.map { it.kind }.toSet())
    }
}
