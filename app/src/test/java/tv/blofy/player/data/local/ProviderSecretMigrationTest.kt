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
class ProviderSecretMigrationTest {
    private lateinit var db: BlofyDatabase
    private val provider = ProviderEntity(
        "migrate-secret", "Saved provider", "https://example.test", "viewer", "password", updatedAt = 456L,
    )

    @Before fun setup() {
        db = Room.inMemoryDatabaseBuilder(RuntimeEnvironment.getApplication(), BlofyDatabase::class.java).build()
    }

    @After fun close() { db.close() }

    @Test fun migrationPreservesUnreadableCiphertextInAMixedLegacyRow(): Unit = runBlocking(Dispatchers.IO) {
        val dao = db.dao()
        val stored = provider.copy(password = "BLOFYENC1:unreadable-legacy-ciphertext")
        dao.upsertProviderStored(stored)
        dao.hardenProviderSecrets()
        val hardened = checkNotNull(dao.providerStored(provider.id))
        assertEquals(stored.password, hardened.password)
        assertEquals(stored.id, hardened.id)
        assertEquals(stored.name, hardened.name)
        assertEquals(stored.updatedAt, hardened.updatedAt)
        assertEquals(stored.enabled, hardened.enabled)
    }

    @Test fun migrationNeverRewritesFullyEncryptedRows(): Unit = runBlocking(Dispatchers.IO) {
        val dao = db.dao()
        val stored = provider.copy(baseUrl = "BLOFYENC1:host", username = "BLOFYENC1:user", password = "BLOFYENC1:pass")
        dao.upsertProviderStored(stored)
        dao.hardenProviderSecrets()
        assertEquals(stored, dao.providerStored(provider.id))
    }

    @Test fun secretMigrationDoesNotDeleteCatalogOrFavoriteFlags(): Unit = runBlocking(Dispatchers.IO) {
        val dao = db.dao()
        dao.upsertProviderStored(provider)
        val stream = StreamEntity("${provider.id}:movie:1", provider.id, "1", null, "movie", "Saved title", favorite = true)
        dao.upsertStreams(listOf(stream))
        dao.hardenProviderSecrets()
        assertEquals(stream, dao.stream(stream.key))
        assertEquals(provider, dao.provider(provider.id))
        assertTrue(dao.hasCatalog(provider.id))
    }

    @Test fun selectingUnavailableEncryptedProviderNeverErasesSavedCredentials(): Unit = runBlocking(Dispatchers.IO) {
        val dao = db.dao()
        val stored = provider.copy(baseUrl = "BLOFYENC1:host", username = "BLOFYENC1:user", password = "BLOFYENC1:pass")
        dao.upsertProviderStored(stored)
        val projection = checkNotNull(dao.provider(provider.id))
        assertEquals("", projection.baseUrl)
        dao.saveAndActivateProvider(projection.copy(name = "Renamed", updatedAt = 999L))
        assertEquals(stored.copy(name = "Renamed", enabled = true, updatedAt = 999L), dao.providerStored(provider.id))
    }
}
