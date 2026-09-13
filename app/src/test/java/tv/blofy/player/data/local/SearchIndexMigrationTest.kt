package tv.blofy.player.data.local

import android.app.Application
import android.content.Context
import android.database.sqlite.SQLiteDatabase
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
import tv.blofy.player.data.CatalogSearchIndex
import tv.blofy.player.data.ContentRepository

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28], application = Application::class)
class SearchIndexMigrationTest {
    private val app get() = RuntimeEnvironment.getApplication()
    private val databaseName = "search-index-migration-regression.db"
    private lateinit var db: BlofyDatabase
    private val provider = ProviderEntity("migration-provider", "Saved", "https://fixture.example.test", "u", "p")

    private fun openDatabase() = Room.databaseBuilder(app, BlofyDatabase::class.java, databaseName)
        .addMigrations(*BlofyDatabase.ALL_MIGRATIONS).build()

    @Before fun setup() {
        app.deleteDatabase(databaseName)
        app.getSharedPreferences("blofy_search_index", Context.MODE_PRIVATE).edit().clear().commit()
        db = openDatabase()
    }

    @After fun cleanup() {
        db.close()
        app.deleteDatabase(databaseName)
    }

    @Test fun v9ReadyPreferenceCannotHideTheIndexDroppedByMigration(): Unit = runBlocking(Dispatchers.IO) {
        val stream = StreamEntity("${provider.id}:movie:1", provider.id, "1", null, "movie", "أحمد", favorite = true)
        val watch = WatchStateEntity(stream.key, provider.id, "movie", 45_000L, 180_000L)
        val activation = ActivationEntity("BLOFY-TEST-ABCD", "123456", activated = true)
        db.dao().upsertProviderStored(provider)
        db.dao().replaceCatalog(provider.id, "movie", emptyList(), listOf(stream))
        db.dao().saveWatchState(watch)
        db.dao().upsertActivation(activation)
        app.getSharedPreferences("blofy_search_index", Context.MODE_PRIVATE).edit()
            .putBoolean("v9_ready_${provider.id}", true).commit()
        db.close()

        // v9 and v10 share all durable catalog tables. Restore only the schema version so Room
        // executes the published 9 -> 10 migration, which deliberately drops/recreates FTS.
        SQLiteDatabase.openDatabase(app.getDatabasePath(databaseName).absolutePath, null, SQLiteDatabase.OPEN_READWRITE)
            .use { restoreV11Providers(it); it.version = 9 }
        db = openDatabase()
        val dao = db.dao()
        assertFalse(dao.hasSearchIndex(provider.id))
        assertFalse(CatalogSearchIndex.isReady(app, provider.id))

        CatalogSearchIndex.ensureReady(app, dao, provider.id)

        assertTrue(CatalogSearchIndex.isReady(app, provider.id))
        assertEquals(listOf(stream), ContentRepository(dao).searchKind(provider.id, "movie", "احمد"))
        assertEquals(provider, dao.provider(provider.id))
        assertEquals(watch, dao.watchState(stream.key))
        assertEquals(activation, dao.activation())
    }

    @Test fun alreadyStreamedIndexIsReusedAndAnEmptyCatalogIsNeverMarkedReady(): Unit = runBlocking(Dispatchers.IO) {
        val dao = db.dao()
        val stream = StreamEntity("${provider.id}:live:1", provider.id, "1", null, "live", "News")
        dao.replaceCatalog(provider.id, "live", emptyList(), listOf(stream))
        fun indexRowId(): Long = db.openHelper.readableDatabase.query(
            "SELECT rowid FROM streams_fts WHERE providerId=?", arrayOf(provider.id)
        ).use { it.moveToFirst(); it.getLong(0) }
        // A sentinel rowid distinguishes reuse from a delete-and-insert rebuild.
        db.openHelper.writableDatabase.execSQL("UPDATE streams_fts SET docid=12345 WHERE providerId=?", arrayOf(provider.id))
        CatalogSearchIndex.ensureReady(app, dao, provider.id)
        assertEquals(12345L, indexRowId())

        assertTrue(runCatching { CatalogSearchIndex.ensureReady(app, dao, "empty-provider") }.isFailure)
        assertFalse(CatalogSearchIndex.isReady(app, "empty-provider"))
    }
}
