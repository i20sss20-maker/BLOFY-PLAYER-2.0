package tv.blofy.player.data.preparation

import android.database.sqlite.SQLiteFullException
import androidx.room.Room
import java.lang.reflect.InvocationTargetException
import java.lang.reflect.Proxy
import java.util.UUID
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import tv.blofy.player.data.CatalogSyncState
import tv.blofy.player.data.FirstImportCheckpoint
import tv.blofy.player.data.local.*

/** Inject a cleanup error at the DAO boundary; never fill a device or remove user data. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28], application = InMemoryKeystoreApplication::class)
class ImportCleanupCheckpointFailureTest {
    @get:Rule internal val databaseIsolation = DatabaseIsolationRule()
    private val app get() = RuntimeEnvironment.getApplication()
    private lateinit var db: BlofyDatabase
    private lateinit var old: ProviderEntity
    private lateinit var incoming: ProviderEntity

    @Before fun setup(): Unit = runBlocking(Dispatchers.IO) {
        db = Room.inMemoryDatabaseBuilder(app, BlofyDatabase::class.java).build()
        old = ProviderEntity(UUID.randomUUID().toString(), "Previous", "https://fixture.example.test", "old", "pass-a")
        incoming = old.copy(id = UUID.randomUUID().toString(), name = "Incoming", username = "new", password = "pass-b")
        db.dao().upsertProviderStored(old)
        db.dao().upsertProviderStored(incoming)
        saveSection(old, "movie")
        CatalogSyncState.markCatalogCommitted(app, old.id)
        saveSection(incoming, "live")
        saveSection(incoming, "movie")
        FirstImportCheckpoint.markCompleted(app, incoming, "live")
    }
    @After fun cleanup() {
        db.close()
        listOf(old, incoming).forEach {
            CatalogSyncState.clear(app, it.id)
            FirstImportCheckpoint.clear(app, it.id)
        }
    }
    private suspend fun saveSection(provider: ProviderEntity, kind: String) {
        db.dao().replaceCatalog(provider.id, kind, emptyList(), listOf(
            StreamEntity("${provider.id}:$kind:1", provider.id, "1", null, kind, "Fixture $kind")
        ))
    }
    private fun failsOnceAtCleanup(): BlofyDao {
        val real = db.dao()
        var injected = false
        return Proxy.newProxyInstance(BlofyDao::class.java.classLoader, arrayOf(BlofyDao::class.java)) { _, method, args ->
            if (method.name == "discardUncommittedCatalogIfSourceUnchanged" && !injected) {
                injected = true
                throw SQLiteFullException("injected cleanup failure")
            }
            try { method.invoke(real, *(args ?: emptyArray())) }
            catch (wrapped: InvocationTargetException) { throw wrapped.targetException }
        } as BlofyDao
    }

    @Test fun failureHandlerDoesNotDeleteVerifiedSectionsAfterCleanupError(): Unit = runBlocking(Dispatchers.IO) {
        val attempt = CatalogLoadPersistence(app, failsOnceAtCleanup(), incoming, incoming.id, true)
        assertTrue(runCatching { attempt.prepareFirstImport() }.exceptionOrNull() is SQLiteFullException)
        attempt.discardIfUncommitted()
        assertEquals(setOf("live"), attempt.completedSections)
        assertEquals(1, db.dao().catalogCountAll(incoming.id, "live"))
        assertEquals(0, db.dao().catalogCountAll(incoming.id, "movie"))
        assertEquals(1, db.dao().catalogCountAll(old.id, "movie"))
        assertTrue(CatalogSyncState.isReady(app, old.id))
    }
}
