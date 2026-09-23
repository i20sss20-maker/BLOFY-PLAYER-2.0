package tv.blofy.player.data

import android.database.sqlite.SQLiteFullException
import androidx.room.Room
import com.google.gson.JsonElement
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.ResponseBody
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import tv.blofy.player.data.local.BlofyDao
import tv.blofy.player.data.local.BlofyDatabase
import tv.blofy.player.data.local.ProviderEntity
import tv.blofy.player.data.local.StreamEntity
import tv.blofy.player.data.preparation.CatalogLoadPersistence
import tv.blofy.player.data.preparation.DatabaseIsolationRule
import tv.blofy.player.data.remote.XtreamApi
import java.util.UUID

/** Exercises public import paths. This same file also compiles on the published website baseline. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28], application = tv.blofy.player.data.local.InMemoryKeystoreApplication::class)
class AccountImportRecoveryRegressionTest {
    @get:Rule internal val isolation = DatabaseIsolationRule()
    private val app get() = RuntimeEnvironment.getApplication()
    private lateinit var db: BlofyDatabase
    private lateinit var provider: ProviderEntity
    private lateinit var previous: ProviderEntity

    @Before fun setup(): Unit = runBlocking(Dispatchers.IO) {
        db = Room.inMemoryDatabaseBuilder(app, BlofyDatabase::class.java).build()
        provider = ProviderEntity(UUID.randomUUID().toString(), "New account", "https://fixture.example.test", "new-user", "new-pass", updatedAt = 100L)
        previous = provider.copy(id = UUID.randomUUID().toString(), name = "Old account", username = "old-user", password = "old-pass")
        db.dao().upsertProviderStored(provider)
        db.dao().upsertProviderStored(previous)
        db.dao().replaceCatalog(previous.id, "movie", emptyList(), listOf(row(previous, "movie", "saved")))
        CatalogSyncState.markCatalogCommitted(app, previous.id)
    }

    @After fun cleanup() {
        db.close()
        for (owner in listOf(provider, previous)) {
            CatalogSyncState.clear(app, owner.id)
            FirstImportCheckpoint.clear(app, owner.id)
        }
    }

    private fun row(owner: ProviderEntity, kind: String, id: String) =
        StreamEntity("${owner.id}:$kind:$id", owner.id, id, null, kind, "Saved $kind $id", favorite = owner.id == previous.id)

    private fun attempt() = CatalogLoadPersistence(app, db.dao(), provider, provider.id, true)

    @Test fun metadataOnlyUpdateDoesNotRejectNewAccountAtFivePercent(): Unit = runBlocking(Dispatchers.IO) {
        db.dao().replaceCatalog(provider.id, "movie", emptyList(), listOf(row(provider, "movie", "partial")))
        // Portal/name/selection updates may occur after the loading Activity took its snapshot.
        val renamed = provider.copy(name = "Renamed by portal", updatedAt = 200L, enabled = true)
        db.dao().upsertProviderStored(renamed)
        attempt().prepareFirstImport()
        assertFalse(db.dao().hasCatalog(provider.id))
        assertEquals(renamed, db.dao().provider(provider.id))
        assertNotNull(db.dao().stream(row(previous, "movie", "saved").key))
        assertTrue(CatalogSyncState.isReady(app, previous.id))
    }

    @Test fun completedSectionSurvivesMetadataUpdateAndRetry(): Unit = runBlocking(Dispatchers.IO) {
        db.dao().replaceCatalog(provider.id, "live", emptyList(), listOf(row(provider, "live", "complete")))
        db.dao().replaceCatalog(provider.id, "movie", emptyList(), listOf(row(provider, "movie", "partial")))
        FirstImportCheckpoint.markCompleted(app, provider, "live")
        db.dao().upsertProviderStored(provider.copy(updatedAt = 300L))
        val retry = attempt()
        retry.prepareFirstImport()
        assertEquals(setOf("live"), retry.completedSections)
        assertNotNull(db.dao().stream(row(provider, "live", "complete").key))
        assertEquals(0, db.dao().catalogCountAll(provider.id, "movie"))
        assertNotNull(db.dao().stream(row(previous, "movie", "saved").key))
    }

    @Test fun differentCredentialsStillRejectStaleAttemptWithoutDeletingNewRows(): Unit = runBlocking(Dispatchers.IO) {
        val replacement = provider.copy(username = "replacement-user", password = "replacement-pass", updatedAt = 500L)
        db.dao().upsertProviderStored(replacement)
        val newer = row(provider, "movie", "newer-source")
        db.dao().replaceCatalog(provider.id, "movie", emptyList(), listOf(newer))
        assertTrue(runCatching { attempt().prepareFirstImport() }.isFailure)
        assertEquals(newer, db.dao().stream(newer.key))
        assertEquals(replacement, db.dao().provider(provider.id))
        assertNotNull(db.dao().stream(row(previous, "movie", "saved").key))
    }

    @Test fun storageFailureStopsOtherSectionsInsteadOfDownloadingIntoFailedStorage(): Unit = runBlocking(Dispatchers.IO) {
        val storage = SQLiteFullException("injected storage failure")
        var laterSections = 0
        val result = runCatching {
            runXtreamSections(listOf(
                { Unit },
                { throw storage },
                { laterSections += 1 }
            ))
        }
        assertSame(storage, result.exceptionOrNull())
        assertEquals(0, laterSections)
    }

    @Test fun storageFailureIsNotReplacedByACleanupFailure(): Unit = runBlocking(Dispatchers.IO) {
        val storage = SQLiteFullException("primary storage failure")
        val cleanup = IllegalStateException("secondary cleanup failure")
        var writeFailed = false
        val failingDao = object : BlofyDao by db.dao() {
            override suspend fun upsertStreams(items: List<StreamEntity>) {
                writeFailed = true
                throw storage
            }
            override suspend fun clearSearchIndex(providerId: String, kind: String) {
                if (writeFailed) throw cleanup
                db.dao().clearSearchIndex(providerId, kind)
            }
        }
        val result = runCatching { PlaylistManager(FixtureApi(), failingDao).syncVod(provider) }
        assertSame(storage, result.exceptionOrNull())
        assertTrue(storage.suppressed.any { it === cleanup })
        assertNotNull(db.dao().stream(row(previous, "movie", "saved").key))
    }

    @Test fun interruptedAccountReplacementKeepsOldCatalogThenRetryCommitsNewAccount(): Unit = runBlocking(Dispatchers.IO) {
        val oldEpoch = CatalogSyncState.lastUpdatedAt(app, previous.id)
        val replacement = previous.copy(username = "replacement-user", password = "replacement-pass", updatedAt = 600L)
        val firstStage = replacement.copy(id = UUID.randomUUID().toString())
        db.dao().replaceCatalog(firstStage.id, "movie", emptyList(), listOf(row(firstStage, "movie", "incomplete")))
        val interrupted = CatalogLoadPersistence(app, db.dao(), previous, firstStage.id, false)
        interrupted.discardIfUncommitted()
        assertEquals(previous.username, db.dao().provider(previous.id)?.username)
        assertEquals(oldEpoch, CatalogSyncState.lastUpdatedAt(app, previous.id))
        assertNotNull(db.dao().stream(row(previous, "movie", "saved").key))
        assertFalse(db.dao().hasCatalog(firstStage.id))

        val retryStage = replacement.copy(id = UUID.randomUUID().toString())
        db.dao().replaceCatalog(retryStage.id, "movie", emptyList(), listOf(row(retryStage, "movie", "new-library")))
        val retry = CatalogLoadPersistence(app, db.dao(), previous, retryStage.id, false)
        retry.commit { db.dao().promoteExplicitSourceReplacement(retryStage.id, replacement, previous) }
        retry.discardIfUncommitted()
        assertTrue(retry.catalogCommitted)
        assertEquals(replacement.username, db.dao().provider(previous.id)?.username)
        assertNotNull(db.dao().stream(row(previous, "movie", "new-library").key))
        assertNull(db.dao().stream(row(previous, "movie", "saved").key))
        assertTrue(CatalogLoadPersistence.hasCommittedCatalog(app, db.dao(), previous.id))
        assertTrue(CatalogSyncState.isEntryReady(app, previous.id))
    }

    @Test fun cancellationDoesNotRunTheFollowingSection(): Unit = runBlocking(Dispatchers.IO) {
        var laterSections = 0
        val result = runCatching { runXtreamSections(listOf(
            { throw CancellationException("user left") }, { laterSections += 1 }
        )) }
        assertTrue(result.exceptionOrNull() is CancellationException)
        assertEquals(0, laterSections)
    }

    private class FixtureApi : XtreamApi {
        override suspend fun list(url: String): List<Map<String, Any?>> = emptyList()
        override suspend fun objectResponse(url: String): Map<String, Any?> = error("Unexpected EPG request")
        override suspend fun jsonResponse(url: String): JsonElement = error("Unexpected details request")
        override fun streamingCall(url: String): retrofit2.Call<ResponseBody> = FixtureCall()
    }
    private class FixtureCall : retrofit2.Call<ResponseBody> {
        private var cancelled = false
        private var executed = false
        override fun enqueue(callback: retrofit2.Callback<ResponseBody>) { executed = true; callback.onResponse(this, execute()) }
        override fun execute(): retrofit2.Response<ResponseBody> {
            // Cross the existing 700-row write boundary; do not change production batch sizes.
            val body = (1..705).joinToString(",", "[", "]") { "{\"stream_id\":$it,\"name\":\"Movie $it\"}" }
            return retrofit2.Response.success(body.toResponseBody("application/json".toMediaType()))
        }
        override fun cancel() { cancelled = true }
        override fun isCanceled() = cancelled
        override fun isExecuted() = executed
        override fun clone(): retrofit2.Call<ResponseBody> = FixtureCall()
        override fun request() = okhttp3.Request.Builder().url("https://fixture.example.test").build()
        override fun timeout() = okio.Timeout.NONE
    }
}
