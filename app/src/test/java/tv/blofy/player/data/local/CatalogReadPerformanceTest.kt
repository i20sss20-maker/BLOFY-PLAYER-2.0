package tv.blofy.player.data.local

import android.app.Application
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

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28], application = Application::class)
class CatalogReadPerformanceTest {
    private val app get() = RuntimeEnvironment.getApplication()
    private val name = "catalog-read-performance.db"
    private lateinit var db: BlofyDatabase
    private fun open() = Room.databaseBuilder(app, BlofyDatabase::class.java, name)
        .addMigrations(*BlofyDatabase.ALL_MIGRATIONS).build()

    @Before fun setup() { app.deleteDatabase(name); db = open() }
    @After fun cleanup() { db.close(); app.deleteDatabase(name) }

    @Test fun homePreservesDateAndNameOrderIncludingNullZeroNegativeAndDuplicateDates(): Unit = runBlocking(Dispatchers.IO) {
        val rows = (0 until 600).map { i ->
            StreamEntity("row-$i", if (i % 5 == 0) "other" else "p", "$i", "c",
                listOf("movie", "series", "live")[i % 3], listOf("عربي", "A", "Z")[i % 3] + (i % 8),
                addedAt = listOf(null, -3L, 0L, 4L, 20L)[i % 5])
        }
        db.dao().upsertStreams(rows)
        for (limit in listOf(0, 1, 14, 96, 600)) {
            val expected = db.openHelper.readableDatabase.query(
                "SELECT `key` FROM streams WHERE providerId='p' AND kind IN ('movie','series') ORDER BY COALESCE(addedAt,0) DESC,name,`key` LIMIT ?", arrayOf(limit)
            ).use { cursor -> buildList { while (cursor.moveToNext()) add(cursor.getString(0)) } }
            assertEquals(expected, db.dao().latestHomeStreams("p", limit).map { it.key })
        }
    }

    @Test fun sparseCategoriesAndLatePagesKeepProviderInsertionOrder(): Unit = runBlocking(Dispatchers.IO) {
        val rows = (0 until 3000).map { i ->
            StreamEntity("row-$i", if (i % 5 == 0) "other" else "p", "$i",
                if (i >= 2950) "rare" else "common", if (i % 2 == 0) "movie" else "series", "Title ${3000-i}")
        }
        db.dao().upsertStreams(rows)
        for (category in listOf(null, "rare", "missing")) {
            val actual = mutableListOf<StreamEntity>()
            var after = 0L
            while (true) {
                val page = if (category == null) db.dao().catalogPageAfterAll("p", "movie", after, 37)
                    else db.dao().catalogPageAfterInCategory("p", "movie", category, after, 37)
                if (page.isEmpty()) break
                actual += page
                after = db.dao().streamRowId(page.last().key)!!
            }
            assertEquals(rows.filter { it.providerId == "p" && it.kind == "movie" && (category == null || it.categoryId == category) }, actual)
        }
    }

    @Test fun v10IndexMigrationKeepsSavedRowsRowidsCredentialsFtsAndResume(): Unit = runBlocking(Dispatchers.IO) {
        val provider = ProviderEntity("p", "Saved", "BLOFYENC1:preserve-host", "BLOFYENC1:preserve-user", "BLOFYENC1:preserve-password")
        val row = StreamEntity("saved", "p", "1", "c", "movie", "Saved", addedAt = 42L, favorite = true)
        val watch = WatchStateEntity(row.key, "p", "movie", 50_000, 100_000)
        val activation = ActivationEntity("BLOFY-TEST-ABCD", "123456", true)
        db.dao().upsertProviderStored(provider)
        db.dao().replaceCatalog("p", "movie", emptyList(), listOf(row))
        db.dao().saveWatchState(watch)
        db.dao().upsertActivation(activation)
        val rowid = db.dao().streamRowId(row.key)
        val ftsCount = db.openHelper.readableDatabase.query("SELECT COUNT(*) FROM streams_fts").use { it.moveToFirst(); it.getInt(0) }
        db.close()
        SQLiteDatabase.openDatabase(app.getDatabasePath(name).absolutePath, null, SQLiteDatabase.OPEN_READWRITE).use {
            restoreV11Providers(it)
            for (index in listOf("index_streams_providerId_kind", "index_streams_providerId_kind_categoryId", "index_streams_home_page")) it.execSQL("DROP INDEX $index")
            it.version = 10
        }
        db = open()
        assertEquals(provider, db.dao().providerStored("p"))
        assertEquals("p", db.dao().activeProviderId()) // Local navigation does not need decryptable credentials.
        assertEquals(rowid, db.dao().streamRowId(row.key))
        assertEquals(listOf(row), db.dao().latestHomeStreams("p"))
        assertEquals(listOf(row), db.dao().catalogPageAfterInCategory("p", "movie", "c", 0, 96))
        assertEquals(watch, db.dao().watchState(row.key))
        assertEquals(activation, db.dao().activation())
        assertEquals(ftsCount, db.openHelper.readableDatabase.query("SELECT COUNT(*) FROM streams_fts").use { it.moveToFirst(); it.getInt(0) })
    }
}
