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
class SubscriberCatalogMigrationTest {
    private val app get() = RuntimeEnvironment.getApplication()
    private val name = "subscriber-migration.db"
    private lateinit var db: BlofyDatabase
    private val proxy = "https://app.example.test/api/v1/subscribers/xtream"
    private val old = ProviderEntity("same-id", "My subscription", proxy, "newest-token", "blofy", updatedAt = 123L)
    private val direct = old.copy(baseUrl = "https://origin.example.test/provider", username = "u", password = "p", subscriberToken = old.username)
    private fun open() = Room.databaseBuilder(app, BlofyDatabase::class.java, name).addMigrations(*BlofyDatabase.ALL_MIGRATIONS).build()
    @Before fun setup() { app.deleteDatabase(name); db = open() }
    @After fun cleanup() { db.close(); app.deleteDatabase(name) }

    @Test fun migrationPreservesLibraryRowIdsFavoritesResumeAndExternalArtwork(): Unit = runBlocking(Dispatchers.IO) {
        val dao = db.dao()
        dao.upsertProviderStored(old)
        val row = StreamEntity("movie-key", old.id, "42", "c", "movie", "Saved", icon = "$proxy/raw/older-token/images/42.jpg",
            directSource = "$proxy/raw/older-token/movie/u/p/42.mp4", backdrop = "https://art.example.test/backdrop.jpg", favorite = true, locked = true)
        val other = row.copy(key = "other-key", providerId = "other")
        dao.replaceCatalog(old.id, "movie", emptyList(), listOf(row))
        dao.upsertStreams(listOf(other))
        dao.upsertEpisodes(listOf(EpisodeEntity("episode", old.id, "series", "7", 1, 1, "Episode", directSource = "$proxy/raw/token/series/u/p/7.mp4")))
        val watch = WatchStateEntity(row.key, old.id, "movie", 40_000, 100_000)
        dao.saveWatchState(watch)
        val rowid = dao.streamRowId(row.key)
        assertTrue(dao.migrateSubscriberConnection(old, direct))
        assertEquals(direct, dao.provider(old.id))
        assertEquals(rowid, dao.streamRowId(row.key))
        assertEquals(watch, dao.watchState(row.key))
        assertEquals(listOf(row.copy(icon = "${direct.baseUrl}/images/42.jpg", directSource = "${direct.baseUrl}/movie/u/p/42.mp4")), dao.streamSnapshot(old.id, "movie"))
        assertEquals(listOf(other), dao.streamSnapshot("other", "movie"))
        assertEquals("${direct.baseUrl}/series/u/p/7.mp4", dao.episodeSnapshot(old.id, "series").single().directSource)
        assertFalse(dao.migrateSubscriberConnection(old, direct))
    }

    @Test fun migrationCannotOverwriteChangedAccountsAndSignedLinksFallBackToCanonicalXtream(): Unit = runBlocking(Dispatchers.IO) {
        val dao = db.dao()
        val row = StreamEntity("signed", old.id, "42", null, "movie", "Saved", directSource = "$proxy/url/token/encrypted/signature", favorite = true)
        dao.upsertProviderStored(old.copy(username = "changed-token"))
        dao.upsertStreams(listOf(row))
        assertFalse(dao.migrateSubscriberConnection(old, direct))
        assertEquals(row, dao.streamSnapshot(old.id, "movie").single())
        dao.upsertProviderStored(old)
        assertTrue(dao.migrateSubscriberConnection(old, direct))
        assertEquals(row.copy(directSource = null), dao.streamSnapshot(old.id, "movie").single())
    }

    @Test fun v11UpgradePreservesStoredCredentialsAndProvidesAnEmptyManagementToken(): Unit = runBlocking(Dispatchers.IO) {
        db.dao().upsertProviderStored(old)
        db.close()
        SQLiteDatabase.openDatabase(app.getDatabasePath(name).absolutePath, null, SQLiteDatabase.OPEN_READWRITE).use {
            restoreV11Providers(it); it.version = 11
        }
        db = open()
        assertEquals(old, db.dao().providerStored(old.id))
        assertEquals(12, db.openHelper.readableDatabase.version)
    }
}
