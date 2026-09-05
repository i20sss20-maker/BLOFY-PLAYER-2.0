package tv.blofy.player.data.preparation

import android.content.Context
import com.google.gson.Gson
import com.google.gson.JsonElement
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Job
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import okhttp3.HttpUrl.Companion.toHttpUrl
import tv.blofy.player.data.CatalogManifestStore
import tv.blofy.player.data.CatalogSyncState
import tv.blofy.player.data.HomeSnapshotStore
import tv.blofy.player.data.SeriesEpisodeParser
import tv.blofy.player.data.local.BlofyDatabase
import tv.blofy.player.data.local.ProviderEntity
import tv.blofy.player.data.local.StreamEntity
import tv.blofy.player.data.metadata.ProviderMetadataCache
import tv.blofy.player.data.metadata.XtreamMetadataFallback
import tv.blofy.player.data.remote.XtreamClient
import tv.blofy.player.ui.catalog.ArtworkLoader
import java.util.concurrent.ConcurrentHashMap

/**
 * Entry preparation is deliberately bounded. Huge Xtream libraries can contain 200k+ items;
 * blocking the user until every detail/episode/image request completes makes first launch unusable.
 *
 * The loading screen waits only for a durable base catalog + local home/search/manifest.
 * Remaining metadata, episodes and artwork continue from local storage in a background scope.
 */
object FullCatalogPreparer {
    private val locks = ConcurrentHashMap<String, Mutex>()
    private data class BackgroundTask(val epoch: Long, val job: Job)
    private val backgroundJobs = ConcurrentHashMap<String, BackgroundTask>()
    private val backgroundScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val gson = Gson()

    private const val BACKGROUND_CONCURRENCY = 3

    data class Update(val percent: Int, val label: String)
    class Incomplete(val missingDetails: Long, val missingImages: Long) : Exception(
        "Library storage is incomplete: $missingDetails details/episodes and $missingImages images remain. Retry to continue."
    )

    /** 100% means the app is safe and fast to enter from local storage; deep enrichment continues. */
    suspend fun prepare(context: Context, providerId: String, progress: suspend (Update) -> Unit) =
        locks.getOrPut(providerId) { Mutex() }.withLock {
            withContext(Dispatchers.IO) {
                val app = context.applicationContext
                val db = BlofyDatabase.get(app)
                val dao = db.dao()
                val provider = checkNotNull(dao.provider(providerId)) { "Playlist was not found" }
                check(CatalogSyncState.isReady(app, providerId)) { "Catalog has not finished saving" }
                val expectedEpoch = CatalogSyncState.lastUpdatedAt(app, providerId)
                suspend fun ensureCurrentSource() {
                    val current = dao.provider(providerId)
                    check(
                        CatalogSyncState.isReady(app, providerId) &&
                            CatalogSyncState.lastUpdatedAt(app, providerId) == expectedEpoch &&
                            current?.baseUrl == provider.baseUrl && current.username == provider.username && current.password == provider.password
                    ) { "Playlist source changed while preparing; continue from the playlist screen" }
                }

                EntryPreparationPipeline.run(
                    home = { HomeSnapshotStore.rebuild(app, dao, provider) },
                    search = {
                        dao.rebuildSearchIndex(providerId)
                        check(app.getSharedPreferences("blofy_search_index", Context.MODE_PRIVATE).edit()
                            .putBoolean("v9_ready_$providerId", true).commit()) { "Unable to persist search readiness" }
                    },
                    commit = {
                        ensureCurrentSource()
                        CatalogManifestStore.rebuild(app, dao, provider, entryVerified = true)
                        CatalogSyncState.markEntryReady(app, providerId, expectedEpoch)
                    },
                    progress = { percent -> progress(Update(percent, "Preparing local library")) }
                )
                // No HTTP/image/detail request belongs to this gate. openHome resumes enrichment
                // separately; a failed or offline image server cannot hold the entry screen open.

            }
        }

    /**
     * A fully-ready library opens immediately on later launches, so preparation is not entered again.
     * Restart background enrichment explicitly to continue from durable metadata/episode/artwork files.
     */
    fun resumeBackground(context: Context, providerId: String) {
        val app = context.applicationContext
        val expectedEpoch = CatalogSyncState.lastUpdatedAt(app, providerId)
        if (expectedEpoch <= 0L || !CatalogSyncState.isReady(app, providerId)) return
        startBackground(app, providerId, expectedEpoch)
    }

    @Synchronized
    private fun startBackground(app: Context, providerId: String, expectedEpoch: Long) {
        val old = backgroundJobs[providerId]
        if (old?.epoch == expectedEpoch && old.job.isActive) return
        old?.job?.cancel()
        val job = backgroundScope.launch(start = CoroutineStart.LAZY) {
            try {
                old?.job?.join()
                enrichAll(app, providerId, expectedEpoch)
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (_: Exception) {
                // Saved units remain durable. Retry on the next explicit resume, not a busy loop.
            } finally {
                val finished = currentCoroutineContext()[Job]
                synchronized(this@FullCatalogPreparer) {
                    if (backgroundJobs[providerId]?.job === finished) backgroundJobs.remove(providerId)
                }
            }
        }
        backgroundJobs[providerId] = BackgroundTask(expectedEpoch, job)
        job.start()
    }

    private suspend fun enrichAll(app: Context, providerId: String, expectedEpoch: Long) {
        val db = BlofyDatabase.get(app)
        val dao = db.dao()
        val provider = dao.provider(providerId) ?: return
        suspend fun ensureSource() {
            currentCoroutineContext().ensureActive()
            val current = dao.provider(providerId)
            check(CatalogSyncState.isReady(app, providerId) && CatalogSyncState.lastUpdatedAt(app, providerId) == expectedEpoch &&
                current?.baseUrl == provider.baseUrl && current.username == provider.username && current.password == provider.password) {
                "Catalog source changed"
            }
        }
        ensureSource()
        val generation = PreparationJournal.hash("${provider.baseUrl}|${provider.username}|${provider.password}|$expectedEpoch")
        PreparationJournal(app).use { journal ->
            journal.begin(providerId, generation)
            var allDetailsSaved = true
            var allEpisodesSaved = true
            var allImagesSaved = true
            for (kind in listOf("series", "movie", "live")) {
                var after = 0L
                while (true) {
                    ensureSource()
                    val page = dao.catalogPageAfterAll(providerId, kind, after, 42)
                    if (page.isEmpty()) break
                    if (kind != "live" && !provider.providerType.equals("m3u", true)) {
                        for (group in page.chunked(BACKGROUND_CONCURRENCY)) {
                            val results = coroutineScope {
                                group.map { stream -> async {
                                    ensureSource()
                                    journal.enqueue(providerId, "detail", stream.key)
                                    if (journal.done(providerId, "detail", stream.key)) true else {
                                        val saved = warmOne(app, db, provider, stream, ::ensureSource)
                                        if (saved) { ensureSource(); journal.complete(providerId, "detail", stream.key) }
                                        saved
                                    }
                                } }.awaitAll()
                            }
                            if (results.any { !it }) {
                                allDetailsSaved = false
                                if (kind == "series") allEpisodesSaved = false
                            }
                        }
                    }
                    for (stream in page) {
                        ensureSource()
                        val metadata = ProviderMetadataCache.read(app, stream.key)
                        for (raw in listOf(stream.icon, stream.backdrop, metadata?.posterUrl, metadata?.backdropUrl)
                            .filterNotNull().map(String::trim).filter { it.isNotBlank() && it != "null" }.distinct()) {
                            try { if (!ArtworkLoader.persist(app, resolve(provider, raw))) allImagesSaved = false }
                            catch (cancelled: CancellationException) { throw cancelled }
                            catch (full: ArtworkLoader.StorageFull) { throw full }
                            catch (_: Exception) { allImagesSaved = false /* Retry on the next pass. */ }
                        }
                    }
                    val next = dao.streamRowId(page.last().key) ?: return
                    if (next <= after) return
                    after = next
                }
            }
            ensureSource()
            if (allDetailsSaved) CatalogSyncState.markMetadataReady(app, providerId)
            if (allEpisodesSaved) CatalogSyncState.markEpisodesReady(app, providerId)
            CatalogManifestStore.rebuild(app, dao, provider,
                completionVerified = allDetailsSaved && allEpisodesSaved && allImagesSaved)
        }
    }

    private suspend fun warmOne(
        app: Context, db: BlofyDatabase, provider: ProviderEntity, stream: StreamEntity,
        ensureSource: suspend () -> Unit,
    ): Boolean {
        val cached = ProviderMetadataCache.read(app, stream.key)
        val episodesAlreadySaved = stream.kind != "series" || db.dao().episodeSnapshot(provider.id, stream.remoteId).isNotEmpty()
        if (cached != null && episodesAlreadySaved) return true
        return retryNetwork {
            val response = fetch(provider, stream)
            val metadata = XtreamMetadataFallback.parseResponse(
                provider, stream, responseMap(response), if (stream.kind == "series") "tv" else "movie"
            )
            ensureSource()
            if (stream.kind == "series") {
                val parsed = SeriesEpisodeParser.parse(provider.id, stream.remoteId, response)
                check(parsed.payloadPresent) { "Invalid series response" }
                db.dao().replaceEpisodes(provider.id, stream.remoteId, parsed.episodes)
            } else {
                check(response.isJsonObject && (response.asJsonObject.has("info") || response.asJsonObject.has("movie_data"))) {
                    "Invalid movie response"
                }
            }
            ensureSource()
            ProviderMetadataCache.write(app, provider.id, stream.key, metadata)
            if (metadata != null) db.openHelper.writableDatabase.execSQL(
                "UPDATE streams SET icon=COALESCE(?,icon),backdrop=COALESCE(?,backdrop),plot=COALESCE(?,plot),genre=COALESCE(?,genre),releaseDate=COALESCE(?,releaseDate),rating=COALESCE(?,rating),duration=COALESCE(?,duration) WHERE `key`=?",
                arrayOf(metadata.posterUrl, metadata.backdropUrl, metadata.overview,
                    metadata.genres.takeIf { it.isNotEmpty() }?.joinToString(", "), metadata.releaseDate,
                    metadata.rating?.toString(), metadata.runtimeMinutes?.toString(), stream.key)
            )
        }
    }

    private suspend fun fetch(provider: ProviderEntity, stream: StreamEntity): JsonElement {
        val series = stream.kind == "series"
        val url = (provider.baseUrl.trimEnd('/') + "/player_api.php").toHttpUrl().newBuilder()
            .addQueryParameter("username", provider.username)
            .addQueryParameter("password", provider.password)
            .addQueryParameter("action", if (series) "get_series_info" else "get_vod_info")
            .addQueryParameter(if (series) "series_id" else "vod_id", SeriesEpisodeParser.normalizeSeriesIdForRequest(stream.remoteId))
            .build().toString()
        return withTimeout(12_000L) { XtreamClient.api.jsonResponse(url) }
    }

    private fun resolve(provider: ProviderEntity, raw: String): String =
        runCatching { java.net.URI(provider.baseUrl.trimEnd('/') + "/").resolve(raw).toString() }.getOrDefault(raw)

    @Suppress("UNCHECKED_CAST")
    private fun responseMap(response: JsonElement): Map<String, Any?> =
        if (response.isJsonObject) gson.fromJson(response, Map::class.java) as Map<String, Any?> else emptyMap()

    private suspend fun retryNetwork(block: suspend () -> Unit): Boolean {
        repeat(2) {
            currentCoroutineContext().ensureActive()
            try { block(); return true }
            catch (_: TimeoutCancellationException) { currentCoroutineContext().ensureActive() }
            catch (cancelled: CancellationException) { throw cancelled }
            catch (error: android.database.sqlite.SQLiteException) { throw error }
            catch (error: ArtworkLoader.StorageFull) { throw error }
            catch (_: Exception) { }
        }
        return false
    }
}
