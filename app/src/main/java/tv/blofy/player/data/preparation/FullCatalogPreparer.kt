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
import kotlinx.coroutines.delay
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import android.os.SystemClock
import java.io.IOException
import okhttp3.HttpUrl.Companion.toHttpUrl
import tv.blofy.player.core.device.DeviceClass
import tv.blofy.player.data.CatalogManifestStore
import tv.blofy.player.data.CatalogSyncState
import tv.blofy.player.data.CatalogSearchIndex
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
                        CatalogSearchIndex.ensureReady(app, dao, providerId)
                    },
                    commit = {
                        ensureCurrentSource()
                        CatalogManifestStore.rebuild(app, dao, provider, entryVerified = true)
                        CatalogSyncState.markEntryReady(app, providerId, expectedEpoch)
                    },
                    progress = { percent -> progress(Update(percent, "Preparing local library")) }
                )
            }
        }

    fun resumeBackground(context: Context, providerId: String) {
        val app = context.applicationContext
        val expectedEpoch = CatalogSyncState.lastUpdatedAt(app, providerId)
        if (expectedEpoch <= 0L || !CatalogSyncState.isReady(app, providerId)) return
        startBackground(app, providerId, expectedEpoch)
    }

    suspend fun runDurableChunk(
        context: Context,
        providerId: String,
        maxRunMs: Long = 6L * 60L * 1000L
    ): Boolean = withContext(Dispatchers.IO) {
        val app = context.applicationContext
        val db = BlofyDatabase.get(app)
        val dao = db.dao()
        val provider = dao.provider(providerId) ?: return@withContext true
        val expectedEpoch = CatalogSyncState.lastUpdatedAt(app, providerId)
        if (expectedEpoch <= 0L || !CatalogSyncState.isReady(app, providerId)) return@withContext true

        suspend fun ensureCurrentSource() {
            currentCoroutineContext().ensureActive()
            val current = dao.provider(providerId)
            check(
                CatalogSyncState.isReady(app, providerId) &&
                    CatalogSyncState.lastUpdatedAt(app, providerId) == expectedEpoch &&
                    current?.baseUrl == provider.baseUrl &&
                    current.username == provider.username &&
                    current.password == provider.password
            ) { "Catalog source changed during full-library sync" }
        }

        val lowMemory = DeviceClass.isLowMemory(app)
        val pageSize = if (lowMemory) 18 else 36
        val artConcurrency = if (lowMemory) 1 else 3
        val detailConcurrency = if (lowMemory) 1 else 2
        val deadline = SystemClock.elapsedRealtime() + maxRunMs.coerceAtLeast(30_000L)

        suspend fun persistArtwork(stream: StreamEntity, phase: FullLibraryPhase): Boolean {
            val metadata = if (phase == FullLibraryPhase.MOVIE_ENRICHED_ART ||
                phase == FullLibraryPhase.SERIES_ENRICHED_ART
            ) ProviderMetadataCache.read(app, stream.key) else null

            val candidates = when (phase) {
                FullLibraryPhase.MOVIE_POSTERS,
                FullLibraryPhase.SERIES_POSTERS,
                FullLibraryPhase.LIVE_LOGOS -> listOfNotNull(stream.icon)
                FullLibraryPhase.MOVIE_BACKDROPS,
                FullLibraryPhase.SERIES_BACKDROPS -> listOfNotNull(stream.backdrop)
                FullLibraryPhase.MOVIE_ENRICHED_ART,
                FullLibraryPhase.SERIES_ENRICHED_ART -> buildList {
                    add(metadata?.posterUrl)
                    add(metadata?.backdropUrl)
                    add(metadata?.logoUrl)
                    metadata?.cast?.forEach { add(it.profileUrl) }
                    metadata?.crew?.forEach { add(it.profileUrl) }
                }.filterNotNull()
                else -> emptyList()
            }.map(String::trim).filter { it.isNotBlank() && !it.equals("null", true) }.distinct()

            if (candidates.isEmpty()) return true
            var savedAny = false
            for (raw in candidates) {
                ensureCurrentSource()
                val resolved = resolve(provider, raw)
                val saved = try {
                    ArtworkLoader.persist(app, resolved)
                } catch (cancelled: CancellationException) {
                    throw cancelled
                }
                savedAny = savedAny || saved
            }
            return savedAny
        }

        while (SystemClock.elapsedRealtime() < deadline) {
            ensureCurrentSource()
            val cursor = FullLibrarySyncState.read(app, providerId, expectedEpoch)
            if (cursor.complete || cursor.phase == FullLibraryPhase.COMPLETE) {
                CatalogSyncState.markMetadataReady(app, providerId)
                CatalogSyncState.markEpisodesReady(app, providerId)
                CatalogManifestStore.rebuild(app, dao, provider, completionVerified = true)
                FullLibrarySyncState.complete(app, providerId, expectedEpoch)
                return@withContext true
            }

            if (provider.providerType.equals("m3u", true) &&
                cursor.phase in setOf(FullLibraryPhase.MOVIE_DETAILS, FullLibraryPhase.SERIES_DETAILS)
            ) {
                FullLibrarySyncState.advance(app, providerId, expectedEpoch, cursor.phase)
                continue
            }

            val kind = cursor.phase.kind ?: run {
                FullLibrarySyncState.complete(app, providerId, expectedEpoch)
                return@withContext true
            }
            val page = dao.catalogPageAfterAll(providerId, kind, cursor.rowId, pageSize)
            if (page.isEmpty()) {
                FullLibrarySyncState.advance(app, providerId, expectedEpoch, cursor.phase)
                continue
            }

            val successes = when (cursor.phase) {
                FullLibraryPhase.MOVIE_DETAILS,
                FullLibraryPhase.SERIES_DETAILS -> coroutineScope {
                    page.chunked(detailConcurrency).flatMap { group ->
                        group.map { stream ->
                            async {
                                ensureCurrentSource()
                                warmOne(app, db, provider, stream, ::ensureCurrentSource)
                            }
                        }.awaitAll()
                    }
                }.count { it }

                else -> coroutineScope {
                    page.chunked(artConcurrency).flatMap { group ->
                        group.map { stream ->
                            async { persistArtwork(stream, cursor.phase) }
                        }.awaitAll()
                    }
                }.count { it }
            }

            // If a whole page that actually contains work failed, treat it as a transient
            // provider/network failure and leave the checkpoint in place for the next worker run.
            val hasWork = when (cursor.phase) {
                FullLibraryPhase.MOVIE_POSTERS,
                FullLibraryPhase.SERIES_POSTERS,
                FullLibraryPhase.LIVE_LOGOS -> page.any { !it.icon.isNullOrBlank() }
                FullLibraryPhase.MOVIE_BACKDROPS,
                FullLibraryPhase.SERIES_BACKDROPS -> page.any { !it.backdrop.isNullOrBlank() }
                else -> true
            }
            if (hasWork && successes == 0) throw IOException("full_library_page_unavailable")

            val nextRow = dao.streamRowId(page.last().key) ?: cursor.rowId
            check(nextRow > cursor.rowId) { "Full-library cursor did not advance" }
            FullLibrarySyncState.checkpoint(app, providerId, expectedEpoch, cursor.phase, nextRow)
            if (lowMemory) delay(35L)
        }
        false
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
        val lowMemory = DeviceClass.isLowMemory(app)
        val pageSize = if (lowMemory) 20 else 42
        val concurrency = if (lowMemory) 1 else 3
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
                    val page = dao.catalogPageAfterAll(providerId, kind, after, pageSize)
                    if (page.isEmpty()) break
                    if (kind != "live" && !provider.providerType.equals("m3u", true)) {
                        for (group in page.chunked(concurrency)) {
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
                        val artwork = listOf(stream.icon, stream.backdrop, metadata?.posterUrl, metadata?.backdropUrl)
                            .filterNotNull().map(String::trim).filter { it.isNotBlank() && it != "null" }.distinct()
                            .let { if (lowMemory) it.take(2) else it }
                        for (raw in artwork) {
                            try { if (!ArtworkLoader.persist(app, resolve(provider, raw))) allImagesSaved = false }
                            catch (cancelled: CancellationException) { throw cancelled }
                            catch (full: ArtworkLoader.StorageFull) { throw full }
                            catch (_: Exception) { allImagesSaved = false }
                        }
                    }
                    val next = dao.streamRowId(page.last().key) ?: return
                    if (next <= after) return
                    after = next
                    // Yield between pages on low-RAM boxes so UI, GC and remote input stay responsive.
                    if (lowMemory) delay(25L)
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
        if (ProviderMetadataCache.lastDetailFetch(app, stream.key) > 0L || (cached != null && episodesAlreadySaved)) return true
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
            ProviderMetadataCache.markDetailFetched(app, stream.key, provider.id)
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
