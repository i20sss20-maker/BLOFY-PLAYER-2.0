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
import tv.blofy.player.data.CatalogSyncState

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28], application = Application::class)
class CatalogLoadRecoveryTest {
    private val app get() = RuntimeEnvironment.getApplication()
    private val databaseName = "catalog-load-recovery-regression.db"
    private lateinit var db: BlofyDatabase
    private val provider = ProviderEntity("interrupted-import", "Saved playlist", "https://fixture.example.test", "u", "p")
    private val stream = StreamEntity("${provider.id}:live:1", provider.id, "1", "news", "live", "Saved channel", favorite = true)
    private val category = CategoryEntity("${provider.id}:live:news", provider.id, "news", "live", "News")
    private val activation = ActivationEntity("BLOFY-TEST-ABCD", "123456", activated = true)

    private fun openDatabase() = Room.databaseBuilder(app, BlofyDatabase::class.java, databaseName).build()

    @Before fun setup(): Unit = runBlocking(Dispatchers.IO) {
        app.deleteDatabase(databaseName)
        CatalogSyncState.clear(app, provider.id)
        db = openDatabase()
        db.dao().upsertProviderStored(provider)
        db.dao().replaceCatalog(provider.id, "live", listOf(category), listOf(stream))
        db.dao().upsertActivation(activation)
    }

    @After fun cleanup() {
        db.close()
        app.deleteDatabase(databaseName)
        CatalogSyncState.clear(app, provider.id)
    }

    @Test fun processDeathBeforeFirstCommitDoesNotTurnPartialRowsIntoAReadyLibrary(): Unit = runBlocking(Dispatchers.IO) {
        // The network parser already emitted batches, but markCatalogCommitted was never reached.
        CatalogSyncState.markPending(app, provider.id)
        db.close()
        db = openDatabase()
        assertTrue(db.dao().hasCatalog(provider.id))
        assertFalse(CatalogSyncState.isReady(app, provider.id))

        CatalogSyncState.discardUncommittedCatalog(app, db.dao(), provider.id)

        assertFalse(db.dao().hasCatalog(provider.id))
        assertFalse(db.dao().hasSearchIndex(provider.id))
        assertTrue(db.dao().allCategoriesForProvider(provider.id).isEmpty())
        assertFalse(CatalogSyncState.isReady(app, provider.id))
        assertEquals(provider, db.dao().provider(provider.id))
        assertEquals(activation, db.dao().activation())
    }

    @Test fun pendingRefreshCannotDiscardThePreviouslyCommittedCatalog(): Unit = runBlocking(Dispatchers.IO) {
        val resume = WatchStateEntity(stream.key, provider.id, "live", 45_000L, 180_000L)
        db.dao().saveWatchState(resume)
        CatalogSyncState.markCatalogCommitted(app, provider.id)
        CatalogSyncState.markPending(app, provider.id)
        db.close()
        db = openDatabase()

        CatalogSyncState.discardUncommittedCatalog(app, db.dao(), provider.id)

        assertTrue(CatalogSyncState.isReady(app, provider.id))
        assertEquals(stream, db.dao().stream(stream.key))
        assertEquals(listOf(category), db.dao().allCategoriesForProvider(provider.id))
        assertEquals(resume, db.dao().watchState(stream.key))
        assertEquals(activation, db.dao().activation())
        assertTrue(db.dao().hasSearchIndex(provider.id))
    }
}
