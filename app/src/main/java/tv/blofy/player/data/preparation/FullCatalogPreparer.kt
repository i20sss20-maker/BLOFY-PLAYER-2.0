package tv.blofy.player.data.preparation

import android.content.Context
import com.google.gson.Gson
import com.google.gson.JsonElement
import kotlinx.coroutines.CancellationException
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
 * The loading screen waits for a durable base catalog + a small priority warm-up + home/search.
 * Remaining metadata, episodes and artwork continue from local storage in a background scope.
 */
object FullCatalogPreparer {
    private val locks = ConcurrentHashMap<String, Mutex>()
    private val backgroundJobs = ConcurrentHashMap<String, kotlinx.coroutines.Job>()
    private val backgroundScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val gson = Gson()

    private const val ENTRY_DETAIL_PER_KIND = 48
    private const val ENTRY_ARTWORK_LIMIT = 240
    private const val ENTRY_CONCURRENCY = 6
    private const val BACKGROUND_CONCURRENCY = 6

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
                val generation = PreparationJournal.hash("${provider.baseUrl}|${provider.username}|${provider.password}|$expectedEpoch")

                suspend fun ensureCurrentSource() {
                    val current = dao.provider(providerId)
                    check(
                        CatalogSyncState.isReady(app, providerId) &&
                            CatalogSyncState.lastUpdatedAt(app, providerId) == expectedEpoch &&
                            current?.baseUrl == provider.baseUrl && current.username == provider.username && current.password == provider.password
                    ) { "Playlist source changed while preparing; continue from the playlist screen" }
                }

                PreparationJournal(app).use { journal ->
                    journal.begin(providerId, generation)

                    suspend fun pages(kind: String, limit: Int? = null, block: suspend (List<StreamEntity>) -> Unit) {
                        var after = 0L
                        var emitted = 0
                        while (true) {
                            currentCoroutineContext().ensureActive()
                            ensureCurrentSource()
                            val wanted = if (limit == null) 36 else minOf(36, limit - emitted)
                            if (wanted <= 0) break
                            val page = dao.catalogPageAfterAll(providerId, kind, after, wanted)
                            if (page.isEmpty()) break
                            block(page)
                            emitted += page.size
                            val next = checkNotNull(dao.streamRowId(page.last().key))
                            check(next > after) { "Unable to continue catalog index" }
                            after = next
                            if (limit != null && emitted >= limit) break
                        }
                    }

                    progress(Update(32, "Preparing priority content for fast entry…"))
                    if (!provider.providerType.equals("m3u", true)) {
                        for (kind in listOf("movie", "series")) {
                            pages(kind, ENTRY_DETAIL_PER_KIND) { page ->
                                coroutineScope {
                                    page.chunked(ENTRY_CONCURRENCY).forEach { group ->
                                        group.map { stream -> async {
                                            warmOne(app, db, provider, stream)
                                        } }.awaitAll()
                                    }
                                }
                            }
                        }
                    }

                    // Entry does not download hundreds of thousands of posters. Persist a bounded
                    // visible set; the rest is filled progressively in the background and on demand.
                    progress(Update(55, "Saving essential library artwork…"))
                    var entryImages = 0
                    outer@ for (kind in listOf("movie", "series", "live")) {
                        pages(kind, 120) { page ->
                            if (entryImages >= ENTRY_ARTWORK_LIMIT) return@pages
                            val urls = page.flatMap { stream ->
                                val metadata = ProviderMetadataCache.read(app, stream.key)
                                listOf(stream.icon, stream.backdrop, metadata?.posterUrl, metadata?.backdropUrl)
                            }.filterNotNull().map(String::trim).filter { it.isNotBlank() && it != "null" }.distinct()
                            for (raw in urls) {
                                if (entryImages >= ENTRY_ARTWORK_LIMIT) break
                                val url = resolve(provider, raw)
                                runCatching { ArtworkLoader.persist(app, url) }
                                entryImages++
                            }
                        }
                        if (entryImages >= ENTRY_ARTWORK_LIMIT) break@outer
                    }

                    progress(Update(82, "Preparing Home from local storage…"))
                    HomeSnapshotStore.rebuild(app, dao, provider)
                    progress(Update(90, "Preparing local search…"))
                    dao.rebuildSearchIndex(providerId)
                    app.getSharedPreferences("blofy_search_index", Context.MODE_PRIVATE).edit()
                        .putBoolean("v9_ready_$providerId", true).commit()

                    // These flags mean the entry barrier is ready. Deep completion is tracked
                    // independently and resumes on every app launch without blocking navigation.
                    CatalogSyncState.markMetadataReady(app, providerId)
                    CatalogSyncState.markEpisodesReady(app, providerId)
                    progress(Update(96, "Verifying library readiness…"))
                    CatalogManifestStore.rebuild(app, dao, provider, completionVerified = true)
                    ensureCurrentSource()
                    CatalogSyncState.markFullyReady(app, providerId, expectedEpoch)
                    check(CatalogSyncState.isFullyReady(app, providerId))
                    progress(Update(100, "Library ready • extra details continue in the background"))
                }

                startBackground(app, providerId, expectedEpoch)
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

    private fun startBackground(app: Context, providerId: String, expectedEpoch: Long) {
        if (backgroundJobs[providerId]?.isActive == true) return
        backgroundJobs[providerId] = backgroundScope.launch {
            try {
                runCatching { enrichAll(app, providerId, expectedEpoch) }
            } finally {
                backgroundJobs.remove(providerId)
            }
        }
    }

    private suspend fun enrichAll(app: Context, providerId: String, expectedEpoch: Long) {
        val db = BlofyDatabase.get(app)
        val dao = db.dao()
        val provider = dao.provider(providerId) ?: return
        if (!CatalogSyncState.isReady(app, providerId) || CatalogSyncState.lastUpdatedAt(app, providerId) != expectedEpoch) return

        for (kind in listOf("series", "movie")) {
            var after = 0L
            while (true) {
                currentCoroutineContext().ensureActive()
                if (CatalogSyncState.lastUpdatedAt(app, providerId) != expectedEpoch) return
                val page = dao.catalogPageAfterAll(providerId, kind, after, 42)
                if (page.isEmpty()) break
                page.chunked(BACKGROUND_CONCURRENCY).forEach { group ->
                    coroutineScope {
                        group.map { stream -> async { warmOne(app, db, provider, stream) } }.awaitAll()
                    }
                }
                for (stream in page) {
                    listOf(
                        stream.icon,
                        stream.backdrop,
                        ProviderMetadataCache.read(app, stream.key)?.posterUrl,
                        ProviderMetadataCache.read(app, stream.key)?.backdropUrl
                    )
                        .filterNotNull().map(String::trim).filter { it.isNotBlank() && it != "null" }.distinct()
                        .forEach { raw -> runCatching { ArtworkLoader.persist(app, resolve(provider, raw)) } }
                }
                val next = dao.streamRowId(page.last().key) ?: return
                if (next <= after) return
                after = next
            }
        }
    }

    private suspend fun warmOne(app: Context, db: BlofyDatabase, provider: ProviderEntity, stream: StreamEntity) {
        if (provider.providerType.equals("m3u", true)) return
        val cached = ProviderMetadataCache.read(app, stream.key)
        val needsEpisodes = stream.kind == "series"
        val episodesAlreadySaved = if (needsEpisodes) {
            db.dao().episodeSnapshot(provider.id, stream.remoteId).isNotEmpty()
        } else true
        if (cached != null && (!needsEpisodes || episodesAlreadySaved)) return

        retryNetwork {
            val response = fetch(provider, stream)
            val metadata = XtreamMetadataFallback.parseResponse(
                provider, stream, responseMap(response), if (stream.kind == "series") "tv" else "movie"
            )
            if (stream.kind == "series") {
                val parsed = SeriesEpisodeParser.parse(provider.id, stream.remoteId, response)
                check(parsed.payloadPresent) { "Invalid series response" }
                db.dao().replaceEpisodes(provider.id, stream.remoteId, parsed.episodes)
            } else {
                check(response.isJsonObject && (response.asJsonObject.has("info") || response.asJsonObject.has("movie_data"))) {
                    "Invalid movie response"
                }
            }
            ProviderMetadataCache.write(app, provider.id, stream.key, metadata)
            if (metadata != null) db.openHelper.writableDatabase.execSQL(
                "UPDATE streams SET icon=COALESCE(?,icon),backdrop=COALESCE(?,backdrop),plot=COALESCE(?,plot),genre=COALESCE(?,genre),releaseDate=COALESCE(?,releaseDate),rating=COALESCE(?,rating),duration=COALESCE(?,duration) WHERE `key`=?",
                arrayOf(
                    metadata.posterUrl, metadata.backdropUrl, metadata.overview,
                    metadata.genres.takeIf { it.isNotEmpty() }?.joinToString(", "), metadata.releaseDate,
                    metadata.rating?.toString(), metadata.runtimeMinutes?.toString(), stream.key
                )
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
