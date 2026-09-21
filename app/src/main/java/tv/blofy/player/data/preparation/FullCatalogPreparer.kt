package tv.blofy.player.data.preparation

import android.content.Context
import com.google.gson.Gson
import com.google.gson.JsonElement
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.ensureActive
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
 * Remaining metadata, episodes and artwork continue from local storage in a persistent worker.
 */
object FullCatalogPreparer {
    private val locks = ConcurrentHashMap<String, Mutex>()
    private val downloadLocks = ConcurrentHashMap<String, Mutex>()
    private class ChunkBudgetReached : Exception()
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

    fun resumeBackground(context: Context, providerId: String) = FullLibrarySyncWorker.enqueue(context, providerId)

    /** Walk every catalog row without a screen visit. The durable queue retains each missing unit. */
    suspend fun runDurableChunk(
        context: Context,
        providerId: String,
        maxRunMs: Long = 6L * 60L * 1000L
    ): Boolean = downloadLocks.getOrPut(providerId) { Mutex() }.withLock {
        withContext(Dispatchers.IO) {
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
                        current?.baseUrl == provider.baseUrl && current.username == provider.username &&
                        current.password == provider.password
                ) { "Catalog source changed during full-library sync" }
            }

            val lowMemory = DeviceClass.isLowMemory(app)
            val pageSize = if (lowMemory) 18 else 36
            val artConcurrency = if (lowMemory) 1 else 3
            val detailConcurrency = if (lowMemory) 1 else 2
            val deadline = SystemClock.elapsedRealtime() + maxRunMs.coerceAtLeast(30_000L)
            val generation = PreparationJournal.hash(
                "${FullLibrarySyncState.REVISION}|${provider.baseUrl}|${provider.username}|${provider.password}|$expectedEpoch"
            )
            try {
                PreparationJournal(app).use { journal ->
                    journal.begin(providerId, generation)

                    suspend fun persistUrl(url: String) {
                        ensureCurrentSource()
                        if (SystemClock.elapsedRealtime() >= deadline) throw ChunkBudgetReached()
                        val key = PreparationJournal.hash(url)
                        if (ArtworkLoader.isPersisted(app, url)) {
                            journal.remove(providerId, "art", key)
                            return
                        }
                        // Persist intent BEFORE HTTP/write; interruption cannot lose the missing image.
                        journal.enqueue(providerId, "art", key, url)
                        val saved = try { ArtworkLoader.persist(app, url) }
                        catch (full: ArtworkLoader.StorageFull) { throw full }
                        catch (_: IOException) { false }
                        ensureCurrentSource()
                        if (saved) journal.remove(providerId, "art", key)
                    }

                    suspend fun persistArtwork(stream: StreamEntity, phase: FullLibraryPhase) {
                        val enriched = phase == FullLibraryPhase.MOVIE_ENRICHED_ART ||
                            phase == FullLibraryPhase.SERIES_ENRICHED_ART
                        val metadata = if (enriched) ProviderMetadataCache.read(app, stream.key) else null
                        val candidates = when (phase) {
                            FullLibraryPhase.MOVIE_POSTERS, FullLibraryPhase.SERIES_POSTERS,
                            FullLibraryPhase.LIVE_LOGOS -> listOf(stream.icon)
                            FullLibraryPhase.MOVIE_BACKDROPS, FullLibraryPhase.SERIES_BACKDROPS -> listOf(stream.backdrop)
                            FullLibraryPhase.MOVIE_ENRICHED_ART, FullLibraryPhase.SERIES_ENRICHED_ART -> buildList {
                                add(stream.icon)
                                add(stream.backdrop)
                                add(metadata?.posterUrl)
                                add(metadata?.backdropUrl)
                                add(metadata?.logoUrl)
                                metadata?.cast?.forEach { add(it.profileUrl) }
                                metadata?.crew?.forEach { add(it.profileUrl) }
                            }
                            else -> emptyList()
                        }.filterNotNull().map(String::trim)
                            .filter { it.isNotBlank() && !it.equals("null", true) }
                            .map { resolve(provider, it) }.distinct()
                        // Every candidate is tracked separately; one saved poster cannot hide missing art.
                        for (url in candidates) persistUrl(url)
                    }

                    suspend fun persistDetails(stream: StreamEntity, retry: Boolean) {
                        ensureCurrentSource()
                        journal.enqueue(providerId, "detail", stream.key)
                        if (warmOne(app, db, provider, stream, ::ensureCurrentSource)) {
                            if (retry) {
                                // A recovered details response can introduce artwork AFTER the catalog pass.
                                val refreshed = dao.stream(stream.key) ?: stream
                                persistArtwork(refreshed, if (stream.kind == "series")
                                    FullLibraryPhase.SERIES_ENRICHED_ART else FullLibraryPhase.MOVIE_ENRICHED_ART)
                            }
                            ensureCurrentSource()
                            journal.remove(providerId, "detail", stream.key)
                        }
                    }

                    while (SystemClock.elapsedRealtime() < deadline) {
                        ensureCurrentSource()
                        val cursor = FullLibrarySyncState.read(app, providerId, expectedEpoch)
                        if (cursor.complete) return@withContext true
                        if (cursor.phase == FullLibraryPhase.COMPLETE) {
                            val missingDetails = journal.counts(providerId, "detail").second
                            val missingImages = journal.counts(providerId, "art").second
                            if (missingDetails > 0L || missingImages > 0L) {
                                FullLibrarySyncState.checkpoint(app, providerId, expectedEpoch, FullLibraryPhase.RETRY_DETAILS, 0L)
                                throw Incomplete(missingDetails, missingImages)
                            }
                            CatalogSyncState.markMetadataReady(app, providerId)
                            CatalogSyncState.markEpisodesReady(app, providerId)
                            CatalogManifestStore.rebuild(app, dao, provider, completionVerified = true)
                            FullLibrarySyncState.complete(app, providerId, expectedEpoch)
                            return@withContext true
                        }

                        if (cursor.phase == FullLibraryPhase.RETRY_DETAILS || cursor.phase == FullLibraryPhase.RETRY_ART) {
                            val details = cursor.phase == FullLibraryPhase.RETRY_DETAILS
                            val kind = if (details) "detail" else "art"
                            val page = journal.pendingPage(providerId, kind, cursor.rowId, pageSize)
                            if (page.isEmpty()) {
                                FullLibrarySyncState.advance(app, providerId, expectedEpoch, cursor.phase)
                                continue
                            }
                            for (group in page.chunked(if (details) detailConcurrency else artConcurrency)) {
                                if (SystemClock.elapsedRealtime() >= deadline) return@withContext false
                                coroutineScope {
                                    group.map { unit -> async {
                                        if (details) {
                                            val stream = dao.stream(unit.key)
                                            if (stream == null) journal.remove(providerId, kind, unit.key)
                                            else persistDetails(stream, retry = true)
                                        } else persistUrl(unit.value)
                                    } }.awaitAll()
                                }
                                ensureCurrentSource()
                                FullLibrarySyncState.checkpoint(app, providerId, expectedEpoch, cursor.phase, group.last().rowId)
                            }
                            continue
                        }

                        val details = cursor.phase == FullLibraryPhase.MOVIE_DETAILS || cursor.phase == FullLibraryPhase.SERIES_DETAILS
                        if (details && provider.providerType.equals("m3u", true)) {
                            FullLibrarySyncState.advance(app, providerId, expectedEpoch, cursor.phase)
                            continue
                        }
                        val kind = checkNotNull(cursor.phase.kind)
                        val page = dao.catalogPageAfterAll(providerId, kind, cursor.rowId, pageSize)
                        if (page.isEmpty()) {
                            FullLibrarySyncState.advance(app, providerId, expectedEpoch, cursor.phase)
                            continue
                        }
                        for (group in page.chunked(if (details) detailConcurrency else artConcurrency)) {
                            // Bound even a page of slow/unavailable URLs below WorkManager's execution limit.
                            if (SystemClock.elapsedRealtime() >= deadline) return@withContext false
                            coroutineScope {
                                group.map { stream -> async {
                                    if (details) persistDetails(stream, retry = false)
                                    else persistArtwork(stream, cursor.phase)
                                } }.awaitAll()
                            }
                            ensureCurrentSource()
                            val nextRow = checkNotNull(dao.streamRowId(group.last().key))
                            check(nextRow > cursor.rowId) { "Full-library cursor did not advance" }
                            FullLibrarySyncState.checkpoint(app, providerId, expectedEpoch, cursor.phase, nextRow)
                        }
                        if (lowMemory) delay(35L)
                    }
                    false
                }
            } catch (_: ChunkBudgetReached) {
                false
            }
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
