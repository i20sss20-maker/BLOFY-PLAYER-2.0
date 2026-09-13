package tv.blofy.player.data.preparation

import android.app.Application
import androidx.room.Room
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.cancel
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.withContext
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import tv.blofy.player.core.identity.PortalPlaylistClient
import tv.blofy.player.core.identity.PortalSyncBook
import tv.blofy.player.data.CatalogSyncState
import tv.blofy.player.data.HomeSnapshotStore
import tv.blofy.player.data.local.BlofyDatabase
import tv.blofy.player.data.local.ProviderEntity
import tv.blofy.player.data.local.StreamEntity
import tv.blofy.player.data.local.WatchStateEntity
import tv.blofy.player.data.metadata.ProviderMetadataCache
import java.util.UUID

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28], application = Application::class)
class CatalogLoadPersistenceTest {
    @get:Rule internal val databaseIsolation = DatabaseIsolationRule()
    private val app get() = RuntimeEnvironment.getApplication()
    private lateinit var db: BlofyDatabase
    private lateinit var provider: ProviderEntity
    private lateinit var staged: ProviderEntity

    @Before fun setup(): Unit = runBlocking(Dispatchers.IO) {
        db = Room.inMemoryDatabaseBuilder(app, BlofyDatabase::class.java).build()
        provider = ProviderEntity(UUID.randomUUID().toString(), "Library", "https://fixture.example.test", "u", "p")
        staged = provider.copy(id = UUID.randomUUID().toString(), enabled = false)
        db.dao().upsertProviderStored(provider)
    }

    @After fun cleanup() {
        db.close()
        CatalogSyncState.clear(app, provider.id)
        ProviderMetadataCache.clearProvider(app, provider.id)
        PortalSyncBook.clearPendingSource(app, provider.id)
    }

    private fun stream(owner: ProviderEntity, kind: String = "live", id: String = "1") =
        StreamEntity("${owner.id}:$kind:$id", owner.id, id, null, kind, "Saved $kind $id")

    private suspend fun saveRows(owner: ProviderEntity, id: String = "1") {
        for (kind in listOf("live", "movie")) {
            db.dao().replaceCatalog(owner.id, kind, emptyList(), listOf(stream(owner, kind, id)))
        }
    }

    private fun attempt(firstLoad: Boolean) = CatalogLoadPersistence(
        app, db.dao(), provider, if (firstLoad) provider.id else staged.id, firstLoad
    )

    @Test fun uncommittedBatchesCannotBecomeAFallbackCatalog(): Unit = runBlocking(Dispatchers.IO) {
        saveRows(provider)
        val resume = WatchStateEntity(stream(provider, "movie").key, provider.id, "movie", 10_000L, 50_000L)
        db.dao().saveWatchState(resume)
        CatalogSyncState.markPending(app, provider.id)

        assertFalse(CatalogLoadPersistence.hasCommittedCatalog(app, db.dao(), provider.id))

        // The 1% startup check is read-only. Cleanup starts after entering the actual import step.
        assertTrue(db.dao().hasCatalog(provider.id))
        assertTrue(db.dao().hasSearchIndex(provider.id))
        attempt(firstLoad = true).prepareFirstImport()

        assertFalse(db.dao().hasCatalog(provider.id))
        assertFalse(db.dao().hasSearchIndex(provider.id))
        assertFalse(CatalogSyncState.isEntryReady(app, provider.id))
        assertEquals(provider, db.dao().provider(provider.id))
        assertEquals(resume, db.dao().watchState(resume.contentKey))
    }

    @Test fun committedRowsRemainUsableWithoutChangingTheirEpoch(): Unit = runBlocking(Dispatchers.IO) {
        saveRows(provider)
        CatalogSyncState.markCatalogCommitted(app, provider.id)
        val epoch = CatalogSyncState.lastUpdatedAt(app, provider.id)

        assertTrue(CatalogLoadPersistence.hasCommittedCatalog(app, db.dao(), provider.id))

        assertEquals(2, db.dao().streamCountForProvider(provider.id))
        assertEquals(epoch, CatalogSyncState.lastUpdatedAt(app, provider.id))
    }

    @Test fun rejectedRefreshPreservesTheOldLibraryAndDiscardsOnlyTheCandidate(): Unit = runBlocking(Dispatchers.IO) {
        saveRows(provider)
        CatalogSyncState.markCatalogCommitted(app, provider.id)
        val epoch = CatalogSyncState.lastUpdatedAt(app, provider.id)
        db.dao().replaceCatalog(staged.id, "live", emptyList(), listOf(stream(staged, id = "2")))
        val persistence = attempt(firstLoad = false)

        val failure = runCatching {
            persistence.commit { db.dao().promoteStagedRefresh(staged.id, provider) }
        }
        persistence.discardIfUncommitted()

        assertTrue(failure.isFailure)
        assertFalse(persistence.catalogCommitted)
        assertEquals(stream(provider), db.dao().stream(stream(provider).key))
        assertEquals(stream(provider, "movie"), db.dao().stream(stream(provider, "movie").key))
        assertEquals(epoch, CatalogSyncState.lastUpdatedAt(app, provider.id))
        assertFalse(db.dao().hasCatalog(staged.id))
        assertTrue(CatalogSyncState.isEntryReady(app, provider.id))
    }

    @Test fun cancellationDuringCommitStillPersistsReadinessAndInvalidatesOldCaches(): Unit = runBlocking(Dispatchers.IO) {
        saveRows(provider)
        CatalogSyncState.markCatalogCommitted(app, provider.id)
        HomeSnapshotStore.rebuild(app, db.dao(), provider)
        ProviderMetadataCache.write(app, provider.id, stream(provider, "movie").key, null)
        val epoch = CatalogSyncState.lastUpdatedAt(app, provider.id)
        saveRows(staged, "2")
        val persistence = attempt(firstLoad = false)
        val saved = CompletableDeferred<Unit>()
        val finishCommit = CompletableDeferred<Unit>()
        val job = launch(Dispatchers.Default) {
            try {
                persistence.commit {
                    db.dao().promoteStagedRefresh(staged.id, provider)
                    saved.complete(Unit)
                    finishCommit.await()
                }
            } finally {
                persistence.discardIfUncommitted()
            }
        }

        saved.await()
        job.cancel()
        finishCommit.complete(Unit)
        job.join()

        assertTrue(job.isCancelled)
        assertTrue(persistence.catalogCommitted)
        assertNotNull(db.dao().stream(stream(provider, id = "2").key))
        assertNull(db.dao().stream(stream(provider).key))
        assertTrue(CatalogSyncState.lastUpdatedAt(app, provider.id) > epoch)
        assertTrue(CatalogSyncState.isEntryReady(app, provider.id))
        assertNull(HomeSnapshotStore.read(app, provider.id))
        assertEquals(0, ProviderMetadataCache.count(app, provider.id))
    }

    @Test fun cancellationBeforeCommitCannotMarkPartialImportReadyAndCleanupStillRuns(): Unit = runBlocking(Dispatchers.IO) {
        saveRows(provider)
        val persistence = attempt(firstLoad = true)
        var wroteProvider = false

        val job = launch(start = CoroutineStart.UNDISPATCHED) {
            cancel()
            try {
                persistence.commit {
                    wroteProvider = true
                    db.dao().saveAndActivateProvider(provider)
                }
            } finally {
                persistence.discardIfUncommitted()
            }
        }
        job.join()

        assertFalse(wroteProvider)
        assertFalse(persistence.catalogCommitted)
        assertFalse(CatalogSyncState.isReady(app, provider.id))
        assertFalse(db.dao().hasCatalog(provider.id))
        assertEquals(provider, db.dao().provider(provider.id))
    }

    @Test fun obsoletePendingSourceCannotOverwriteTheNewerChoice(): Unit = runBlocking(Dispatchers.IO) {
        saveRows(provider)
        CatalogSyncState.markCatalogCommitted(app, provider.id)
        val oldCandidate = provider.copy(baseUrl = "https://old-candidate.example.test")
        val newCandidate = provider.copy(baseUrl = "https://new-candidate.example.test")
        val pendingId = PortalSyncBook.pendingSourceId(provider.id)
        db.dao().upsertProviderStored(newCandidate.copy(id = pendingId, enabled = false))
        PortalSyncBook.markPendingSource(app, provider.id)
        saveRows(staged, "2")
        val persistence = attempt(firstLoad = false)

        val failure = runCatching {
            PortalPlaylistClient.commitPendingSource(app, db.dao(), oldCandidate) {
                persistence.commit { db.dao().promoteStagedRefresh(staged.id, oldCandidate) }
            }
        }
        persistence.discardIfUncommitted()

        assertTrue(failure.isFailure)
        assertFalse(persistence.catalogCommitted)
        assertEquals(provider.baseUrl, db.dao().provider(provider.id)?.baseUrl)
        assertEquals(newCandidate.baseUrl, PortalPlaylistClient.pendingSource(app, db.dao(), provider.id)?.baseUrl)
        assertEquals(stream(provider), db.dao().stream(stream(provider).key))
        assertFalse(db.dao().hasCatalog(staged.id))
    }

    @Test fun cachedEntryActivatesTheRequestedProviderWithoutReplacingItsData(): Unit = runBlocking(Dispatchers.IO) {
        saveRows(provider)
        CatalogSyncState.markCatalogCommitted(app, provider.id)
        val other = provider.copy(id = UUID.randomUUID().toString(), name = "Other")
        db.dao().saveAndActivateProvider(other)
        val before = checkNotNull(db.dao().provider(provider.id))
        val epoch = CatalogSyncState.lastUpdatedAt(app, provider.id)

        db.dao().activateExistingProvider(provider.id)

        val selected = checkNotNull(db.dao().provider(provider.id))
        assertTrue(selected.enabled)
        assertFalse(checkNotNull(db.dao().provider(other.id)).enabled)
        assertEquals(before.baseUrl, selected.baseUrl)
        assertEquals(before.username, selected.username)
        assertEquals(before.password, selected.password)
        assertEquals(before.updatedAt, selected.updatedAt)
        assertEquals(2, db.dao().streamCountForProvider(provider.id))
        assertEquals(epoch, CatalogSyncState.lastUpdatedAt(app, provider.id))
    }

    @Test fun nextActivityWaitsUntilCanceledImportCleanupFinishes(): Unit = runBlocking(Dispatchers.IO) {
        val firstStarted = CompletableDeferred<Unit>()
        val cleanupStarted = CompletableDeferred<Unit>()
        val allowCleanup = CompletableDeferred<Unit>()
        val cleanupFinished = CompletableDeferred<Unit>()
        val nextStarted = CompletableDeferred<Unit>()
        val old = launch(Dispatchers.Default) {
            CatalogLoadPersistence.withProviderLock(provider.id) {
                val persistence = attempt(firstLoad = true)
                try {
                    persistence.prepareFirstImport()
                    saveRows(provider)
                    firstStarted.complete(Unit)
                    awaitCancellation()
                } finally {
                    withContext(NonCancellable) {
                        cleanupStarted.complete(Unit)
                        allowCleanup.await()
                        persistence.discardIfUncommitted()
                        cleanupFinished.complete(Unit)
                    }
                }
            }
        }
        firstStarted.await()
        old.cancel()
        cleanupStarted.await()

        val next = launch(start = CoroutineStart.UNDISPATCHED) {
            CatalogLoadPersistence.withProviderLock(provider.id) {
                nextStarted.complete(Unit)
                assertTrue(cleanupFinished.isCompleted)
                val persistence = attempt(firstLoad = true)
                persistence.prepareFirstImport()
                saveRows(provider, "2")
                persistence.commit { db.dao().activateImportedProvider(provider) }
            }
        }

        assertFalse(nextStarted.isCompleted)
        allowCleanup.complete(Unit)
        old.join()
        next.join()

        assertTrue(CatalogSyncState.isEntryReady(app, provider.id))
        assertNotNull(db.dao().stream(stream(provider, id = "2").key))
        assertNull(db.dao().stream(stream(provider).key))
        assertEquals(2, db.dao().streamCountForProvider(provider.id))
    }

    @Test fun canceledQueuedActivityNeverBeginsImport(): Unit = runBlocking(Dispatchers.IO) {
        val locked = CompletableDeferred<Unit>()
        val release = CompletableDeferred<Unit>()
        val first = launch {
            CatalogLoadPersistence.withProviderLock(provider.id) {
                locked.complete(Unit)
                release.await()
            }
        }
        locked.await()
        var nextStarted = false
        val queued = launch(start = CoroutineStart.UNDISPATCHED) {
            CatalogLoadPersistence.withProviderLock(provider.id) {
                nextStarted = true
                saveRows(provider)
            }
        }
        queued.cancelAndJoin()
        release.complete(Unit)
        first.join()

        assertFalse(nextStarted)
        assertFalse(db.dao().hasCatalog(provider.id))
        assertFalse(CatalogSyncState.isReady(app, provider.id))
    }

    @Test fun explicitReplacementRequiresTheExactApprovedPendingSourceAndForcedRefresh() {
        val pending = provider.copy(baseUrl = "https://replacement.example.test", username = "new-account", password = "new-token")
        val fingerprint = PortalPlaylistClient.sourceFingerprint(pending)

        assertTrue(CatalogLoadPersistence.isApprovedSourceReplacement(true, pending, fingerprint))
        assertFalse(CatalogLoadPersistence.isApprovedSourceReplacement(false, pending, fingerprint))
        assertFalse(CatalogLoadPersistence.isApprovedSourceReplacement(true, null, fingerprint))
        assertFalse(CatalogLoadPersistence.isApprovedSourceReplacement(true, pending, null))
        assertFalse(CatalogLoadPersistence.isApprovedSourceReplacement(true, pending, ""))
        assertFalse(CatalogLoadPersistence.isApprovedSourceReplacement(true, pending.copy(id = "another-playlist"), fingerprint))
        assertFalse(CatalogLoadPersistence.isApprovedSourceReplacement(true, pending.copy(username = "another-account"), fingerprint))
        assertFalse(CatalogLoadPersistence.isApprovedSourceReplacement(true, pending.copy(password = "newer-token"), fingerprint))
    }
}
