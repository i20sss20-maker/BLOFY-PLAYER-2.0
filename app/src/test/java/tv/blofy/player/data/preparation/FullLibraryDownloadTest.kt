package tv.blofy.player.data.preparation

import android.content.Context
import android.graphics.Bitmap
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.runBlocking
import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import okio.Buffer
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import tv.blofy.player.data.CatalogManifestStore
import tv.blofy.player.data.CatalogSyncState
import tv.blofy.player.data.local.BlofyDatabase
import tv.blofy.player.data.local.ProviderEntity
import tv.blofy.player.data.local.StreamEntity
import tv.blofy.player.data.metadata.ProviderMetadata
import tv.blofy.player.data.metadata.ProviderMetadataCache
import tv.blofy.player.ui.catalog.ArtworkLoader
import java.io.ByteArrayOutputStream
import java.io.File
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicInteger

/** Real catalog -> full-library downloader -> files, without binding a single poster view. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28], application = tv.blofy.player.data.local.InMemoryKeystoreApplication::class)
class FullLibraryDownloadTest {
    @get:Rule internal val isolation = DatabaseIsolationRule()
    private val app get() = RuntimeEnvironment.getApplication()
    private val db get() = BlofyDatabase.get(app)
    private lateinit var server: MockWebServer
    private lateinit var provider: ProviderEntity
    private val failed = ConcurrentHashMap.newKeySet<String>()
    private val requests = ConcurrentHashMap<String, AtomicInteger>()
    private val epoch get() = CatalogSyncState.lastUpdatedAt(app, provider.id)

    @Before fun setup() = runBlocking(Dispatchers.IO) {
        ArtworkLoader.clearMemory()
        app.deleteDatabase("blofy-preparation-v1.db")
        val bytes = ByteArrayOutputStream().also {
            Bitmap.createBitmap(16, 24, Bitmap.Config.ARGB_8888).compress(Bitmap.CompressFormat.PNG, 100, it)
        }.toByteArray()
        server = MockWebServer().apply {
            dispatcher = object : Dispatcher() {
                override fun dispatch(request: RecordedRequest): MockResponse {
                    val path = request.requestUrl!!.encodedPath
                    requests.computeIfAbsent(path) { AtomicInteger() }.incrementAndGet()
                    if (failed.contains(path)) return MockResponse().setResponseCode(503)
                    if (path == "/player_api.php") return MockResponse().setHeader("Content-Type", "application/json")
                        .setBody("""{"info":{"name":"Recovered","movie_image":"${url("/detail-poster")}","backdrop_path":["${url("/detail-backdrop")}"]},"movie_data":{"name":"Recovered"}}""")
                    return MockResponse().setHeader("Content-Type", "image/png").setBody(Buffer().write(bytes))
                }
            }
            start()
        }
        provider = ProviderEntity(UUID.randomUUID().toString(), "Bulk fixture", server.url("/").toString(), "u", "p", providerType = "m3u")
        db.dao().upsertProvider(provider)
        CatalogSyncState.markCatalogCommitted(app, provider.id)
    }

    @After fun cleanup() {
        ArtworkLoader.clearMemory()
        server.shutdown()
        app.deleteDatabase("blofy-preparation-v1.db")
    }

    private fun stream(id: Int, kind: String = "movie", icon: String? = server.url("/poster-$id").toString(), backdrop: String? = null) =
        StreamEntity("${provider.id}:$kind:$id", provider.id, "$id", null, kind, "Item $id", icon = icon, backdrop = backdrop)
    private fun count(path: String) = requests[path]?.get() ?: 0
    private suspend fun download() = FullCatalogPreparer.runDurableChunk(app, provider.id)
    private suspend fun incomplete(): FullCatalogPreparer.Incomplete {
        try { download(); fail("Missing files must not be marked complete") }
        catch (expected: FullCatalogPreparer.Incomplete) { return expected }
        error("Expected incomplete download")
    }
    private fun saved(path: String) = ArtworkLoader.isPersisted(app, server.url(path).toString())
    private fun cursor() = FullLibrarySyncState.read(app, provider.id, epoch)

    @Test fun allPagesAndKindsDownloadBeforeAnyScreenIsOpenedAndReopenWithoutHttp() = runBlocking(Dispatchers.IO) {
        val streams = listOf("movie", "series", "live").flatMapIndexed { kindIndex, kind ->
            (1..45).map { n -> stream(kindIndex * 100 + n, kind) }
        }
        db.dao().upsertStreams(streams)
        assertTrue(download())
        assertEquals(135, server.requestCount)
        assertTrue(streams.all { ArtworkLoader.isPersisted(app, it.icon!!) })
        assertTrue(cursor().complete)
        ArtworkLoader.clearMemory()
        File(app.cacheDir, "blofy_posters").deleteRecursively()
        // A catalog refresh revisits rows but reuses every already-saved URL.
        CatalogSyncState.markCatalogCommitted(app, provider.id)
        assertTrue(download())
        assertEquals(135, server.requestCount)
        assertTrue(CatalogManifestStore.read(app, provider.id)!!.fullyReady)
    }

    @Test fun oneFailedImageDoesNotSkipItOrBlockLaterPagesAndOnlyMissingImageRetries() = runBlocking(Dispatchers.IO) {
        db.dao().upsertStreams((1..80).map { stream(it) })
        failed.add("/poster-2")
        assertEquals(1L, incomplete().missingImages)
        assertFalse(cursor().complete)
        assertTrue(saved("/poster-80"))
        assertEquals(1, count("/poster-1"))
        assertFalse(CatalogSyncState.isMetadataReady(app, provider.id))
        val before = server.requestCount
        failed.clear()
        ArtworkLoader.clearMemory()
        File(app.cacheDir, "blofy_posters").deleteRecursively()
        assertTrue(download())
        assertEquals("Resume must request only the single missing image", before + 1, server.requestCount)
        assertTrue(saved("/poster-2"))
        assertTrue(cursor().complete)
    }

    @Test fun wholeUnavailablePageDoesNotPreventFollowingPagesFromSaving() = runBlocking(Dispatchers.IO) {
        db.dao().upsertStreams((1..80).map { stream(it) })
        (1..36).forEach { failed.add("/poster-$it") }
        assertEquals(36L, incomplete().missingImages)
        assertTrue(saved("/poster-80"))
        assertEquals(1, count("/poster-80"))
        assertFalse(cursor().complete)
    }

    @Test fun eachEnrichedImageIsRequiredAndFailedCastPhotoSurvivesJournalReopen() = runBlocking(Dispatchers.IO) {
        val item = stream(1, icon = null)
        db.dao().upsertStreams(listOf(item))
        ProviderMetadataCache.write(app, provider.id, item.key, ProviderMetadata.Metadata(
            kind = "movie", title = "One", overview = null, rating = null, releaseDate = null,
            runtimeMinutes = null, genres = emptyList(), posterUrl = server.url("/enriched-poster").toString(),
            backdropUrl = server.url("/enriched-backdrop").toString(), logoUrl = server.url("/logo").toString(),
            cast = listOf(ProviderMetadata.Person(1, "Person", null, server.url("/cast").toString())),
            crew = listOf(ProviderMetadata.Credit("Director", "Director", server.url("/crew").toString()))
        ))
        failed.add("/cast")
        assertEquals(1L, incomplete().missingImages)
        listOf("/enriched-poster", "/enriched-backdrop", "/logo", "/crew").forEach { assertTrue(saved(it)) }
        PreparationJournal(app).use { assertEquals(1L, it.counts(provider.id, "art").second) }
        val before = server.requestCount
        failed.clear()
        assertTrue(download())
        assertEquals(before + 1, server.requestCount)
        assertTrue(saved("/cast"))
    }

    @Test fun legacyFalseCompletionIsAuditedWithoutRedownloadingSavedArt() = runBlocking(Dispatchers.IO) {
        db.dao().upsertStreams(listOf(stream(1), stream(2)))
        assertTrue(ArtworkLoader.persist(app, server.url("/poster-1").toString()))
        // The old algorithm persisted ordinal 9 (COMPLETE) despite a missing second image.
        app.getSharedPreferences("blofy_full_library_sync_v1", Context.MODE_PRIVATE).edit()
            .putLong("${provider.id}:epoch", epoch).putInt("${provider.id}:phase", 9)
            .putBoolean("${provider.id}:complete", true).remove("${provider.id}:revision").commit()
        assertTrue(download())
        assertEquals(1, count("/poster-1"))
        assertEquals(1, count("/poster-2"))
        assertTrue(saved("/poster-2"))
    }

    @Test fun concurrentInvocationsShareCheckpointAndDoNotDuplicateHttp() = runBlocking(Dispatchers.IO) {
        db.dao().upsertStreams((1..30).map { stream(it) })
        coroutineScope { List(2) { async { download() } }.awaitAll() }.forEach { assertTrue(it) }
        assertEquals(30, server.requestCount)
        assertTrue(cursor().complete)
    }

    @Test fun recoveredDetailsAlsoDownloadArtworkDiscoveredAfterInitialScan() = runBlocking(Dispatchers.IO) {
        provider = provider.copy(providerType = "xtream")
        db.dao().upsertProvider(provider)
        db.dao().upsertStreams(listOf(stream(1)))
        failed.add("/player_api.php")
        assertEquals(1L, incomplete().missingDetails)
        assertTrue(saved("/poster-1"))
        failed.clear()
        assertTrue(download())
        assertTrue(saved("/detail-poster"))
        assertTrue(saved("/detail-backdrop"))
        assertEquals(1, count("/poster-1"))
        assertTrue(CatalogSyncState.isMetadataReady(app, provider.id))
    }

    @Test fun blankPrimaryUsesSavedBackdropAndSharedUrlsDownloadOnce() = runBlocking(Dispatchers.IO) {
        db.dao().upsertStreams((1..8).map { stream(it, icon = " ", backdrop = "/shared") })
        assertTrue(download())
        assertTrue(saved("/shared"))
        assertEquals(1, server.requestCount)
    }
}
