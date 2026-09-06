package tv.blofy.player.data.preparation

import android.app.Application
import android.content.Context
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import tv.blofy.player.data.CatalogManifestStore
import tv.blofy.player.data.CatalogSyncState
import tv.blofy.player.data.HomeSnapshotStore
import tv.blofy.player.data.local.BlofyDatabase
import tv.blofy.player.data.local.ProviderEntity
import tv.blofy.player.data.local.StreamEntity
import java.util.UUID

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28], application = Application::class)
class LocalEntryIntegrationTest {
    private val app get() = RuntimeEnvironment.getApplication()
    private lateinit var server: MockWebServer
    private lateinit var provider: ProviderEntity
    private val db get() = BlofyDatabase.get(app)

    @Before fun setup() = runBlocking(Dispatchers.IO) {
        server = MockWebServer().also { it.start() }
        provider = ProviderEntity(UUID.randomUUID().toString(), "Library", server.url("/").toString(), "u", "p")
        db.dao().upsertProvider(provider)
        // Use the same transactional catalog path as a real sync. replaceCatalog maintains FTS
        // incrementally, so the entry gate never has to rebuild a 200k+ item search index.
        listOf("movie", "series", "live").forEach { kind ->
            db.dao().replaceCatalog(provider.id, kind, emptyList(), listOf(stream(kind, 1)))
        }
        CatalogSyncState.markCatalogCommitted(app, provider.id)
    }

    @After fun cleanup() = runBlocking(Dispatchers.IO) {
        db.dao().clearProviderCatalog(provider.id)
        db.dao().deleteProvider(provider.id)
        CatalogSyncState.clear(app, provider.id)
        server.shutdown()
    }

    private fun stream(kind: String, id: Int) = StreamEntity(
        "${provider.id}:$kind:$id", provider.id, id.toString(), null, kind, "Item $id",
        icon = server.url("/unavailable.jpg").toString(), addedAt = id.toLong())

    private suspend fun prepare() {
        withTimeout(15_000L) { FullCatalogPreparer.prepare(app, provider.id) {} }
    }

    @Test fun savedCatalogEntersWithoutAnyDetailOrImageHttpRequests() = runBlocking(Dispatchers.IO) {
        val progress = mutableListOf<Int>()
        withTimeout(15_000L) { FullCatalogPreparer.prepare(app, provider.id) { progress += it.percent } }
        assertEquals(0, server.requestCount)
        assertEquals(100, progress.last())
        assertEquals(progress.sorted(), progress)
        assertTrue(CatalogSyncState.isEntryReady(app, provider.id))
        assertFalse(CatalogSyncState.isMetadataReady(app, provider.id))
        assertFalse(CatalogSyncState.areEpisodesReady(app, provider.id))
        val manifest = checkNotNull(CatalogManifestStore.read(app, provider.id))
        assertTrue(manifest.entryReady)
        assertFalse(manifest.fullyReady)
        assertEquals(CatalogSyncState.lastUpdatedAt(app, provider.id), manifest.catalogEpoch)
    }

    @Test fun localSearchContainsEveryPageAndEveryKind() = runBlocking(Dispatchers.IO) {
        db.dao().replaceCatalog(provider.id, "movie", emptyList(), (1..1405).map { stream("movie", it) })
        prepare()
        val count = db.openHelper.readableDatabase.query(
            "SELECT COUNT(*) FROM streams_fts WHERE providerId=?", arrayOf(provider.id)
        ).use { it.moveToFirst(); it.getInt(0) }
        assertEquals(1407, count)
        assertEquals(0, server.requestCount)
    }

    @Test fun readinessSurvivesRereadButNotAChangedCatalogGeneration() = runBlocking(Dispatchers.IO) {
        prepare()
        assertTrue(CatalogSyncState.isFullyReady(app, provider.id))
        val previousEpoch = CatalogSyncState.lastUpdatedAt(app, provider.id)
        CatalogSyncState.markCatalogCommitted(app, provider.id)
        assertTrue(CatalogSyncState.lastUpdatedAt(app, provider.id) > previousEpoch)
        assertFalse(CatalogSyncState.isEntryReady(app, provider.id))
        val stale = runCatching { CatalogSyncState.markEntryReady(app, provider.id, previousEpoch) }
        assertTrue(stale.isFailure)
        prepare()
        assertTrue(CatalogSyncState.isEntryReady(app, provider.id))
        assertEquals(0, server.requestCount)
    }

    @Test fun legacyFullFlagsDoNotTriggerRemoteWarmupOnUpgrade() = runBlocking(Dispatchers.IO) {
        app.getSharedPreferences("blofy_catalog_sync_state", Context.MODE_PRIVATE).edit()
            .putBoolean("verified_v2:${provider.id}", true).commit()
        assertFalse(CatalogSyncState.isEntryReady(app, provider.id))
        prepare()
        assertTrue(CatalogSyncState.isEntryReady(app, provider.id))
        assertEquals(0, server.requestCount)
    }

    @Test fun missingLocalSnapshotInvalidatesOnlyEntryNotSavedCatalog() = runBlocking(Dispatchers.IO) {
        prepare()
        HomeSnapshotStore.clear(app, provider.id)
        assertFalse(CatalogSyncState.isEntryReady(app, provider.id))
        assertTrue(CatalogSyncState.isReady(app, provider.id))
        assertTrue(db.dao().hasCatalog(provider.id))
        prepare()
        assertTrue(CatalogSyncState.isEntryReady(app, provider.id))
    }

    @Test fun missingSearchReadyFlagPreventsFalseReadiness() = runBlocking(Dispatchers.IO) {
        prepare()
        app.getSharedPreferences("blofy_search_index", Context.MODE_PRIVATE).edit()
            .remove("v9_ready_${provider.id}").commit()
        assertFalse(CatalogSyncState.isEntryReady(app, provider.id))
        prepare()
        assertTrue(CatalogSyncState.isEntryReady(app, provider.id))
    }
    @Test fun stagedRefreshPromotesSearchIndexWithoutFullRebuild() = runBlocking(Dispatchers.IO) {
        val stagedId = UUID.randomUUID().toString()
        val stagedProvider = provider.copy(id = stagedId, enabled = false)
        db.dao().upsertProvider(stagedProvider)
        val stagedStreams = (1..1605).map { id ->
            StreamEntity(
                "$stagedId:movie:$id", stagedId, id.toString(), null, "movie", "Refresh Item $id",
                icon = null, addedAt = id.toLong()
            )
        }
        db.dao().replaceCatalog(stagedId, "movie", emptyList(), stagedStreams)

        db.dao().promoteStagedCatalog(
            stagedId,
            provider.copy(enabled = true, updatedAt = System.currentTimeMillis() + 10_000L)
        )

        val ftsCount = db.openHelper.readableDatabase.query(
            "SELECT COUNT(*) FROM streams_fts WHERE providerId=?", arrayOf(provider.id)
        ).use { it.moveToFirst(); it.getInt(0) }
        val staleFtsCount = db.openHelper.readableDatabase.query(
            "SELECT COUNT(*) FROM streams_fts WHERE providerId=?", arrayOf(stagedId)
        ).use { it.moveToFirst(); it.getInt(0) }
        val promoted = db.dao().searchStreamsFts(provider.id, "Refresh*", 10)

        assertEquals(1605, ftsCount)
        assertEquals(0, staleFtsCount)
        assertTrue(promoted.isNotEmpty())
        assertTrue(promoted.all { it.providerId == provider.id && it.key.startsWith(provider.id + ":movie:") })
    }

}
