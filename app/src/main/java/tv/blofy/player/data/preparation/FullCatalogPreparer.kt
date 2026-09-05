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
import kotlinx.coroutines.ensureActive
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

/** A user-initiated, awaited preparation barrier. Back/process death resumes from durable units. */
object FullCatalogPreparer {
    private val locks = ConcurrentHashMap<String, Mutex>()
    private val gson = Gson()
    data class Update(val percent: Int, val label: String)
    class Incomplete(val missingDetails: Long, val missingImages: Long) : Exception(
        "التخزين غير مكتمل: $missingDetails عنصر تفاصيل/حلقات و$missingImages صورة. أعد المحاولة لاستكمال الناقص."
    )

    suspend fun prepare(context: Context, providerId: String, progress: suspend (Update) -> Unit) =
        locks.getOrPut(providerId) { Mutex() }.withLock {
            withContext(Dispatchers.IO) {
                val app = context.applicationContext
                val db = BlofyDatabase.get(app)
                val dao = db.dao()
                val provider = checkNotNull(dao.provider(providerId)) { "قائمة التشغيل غير موجودة" }
                check(CatalogSyncState.isReady(app, providerId)) { "قائمة المحتوى لم يكتمل حفظها" }
                val expectedEpoch = CatalogSyncState.lastUpdatedAt(app, providerId)
                val generation = PreparationJournal.hash("${provider.baseUrl}|${provider.username}|${provider.password}|${CatalogSyncState.lastUpdatedAt(app, providerId)}")
                suspend fun ensureCurrentSource() {
                    val current = dao.provider(providerId)
                    check(CatalogSyncState.isReady(app, providerId) && CatalogSyncState.lastUpdatedAt(app, providerId) == expectedEpoch &&
                        current?.baseUrl == provider.baseUrl && current.username == provider.username && current.password == provider.password) {
                        "مصدر القائمة تغير أثناء التحميل؛ استكمل من شاشة القوائم"
                    }
                }
                PreparationJournal(app).use { journal ->
                    journal.begin(providerId, generation)
                    suspend fun emit(stage: PreparationProgress.Stage, kind: String, label: String) {
                        val (done, total) = journal.counts(providerId, kind)
                        progress(Update(PreparationProgress.percent(stage, done, total), "$label • $done / $total"))
                    }
                    suspend fun pages(kind: String, block: suspend (List<StreamEntity>) -> Unit) {
                        var after = 0L
                        while (true) {
                            currentCoroutineContext().ensureActive()
                            ensureCurrentSource()
                            val page = dao.catalogPageAfterAll(providerId, kind, after, 36)
                            if (page.isEmpty()) break
                            block(page)
                            val next = checkNotNull(dao.streamRowId(page.last().key))
                            check(next > after) { "تعذر متابعة فهرس المحتوى" }
                            after = next
                        }
                    }
                    // Plan detail work first so the denominator does not change mid-stage.
                    if (!provider.providerType.equals("m3u", true)) {
                        for (kind in listOf("movie", "series")) pages(kind) { page ->
                            page.forEach { journal.enqueue(providerId, "detail", it.key) }
                        }
                        for (kind in listOf("movie", "series")) pages(kind) { page ->
                            page.chunked(3).forEach { group ->
                                coroutineScope {
                                    group.map { stream -> async {
                                        if (!journal.done(providerId, "detail", stream.key)) {
                                            val success = retryNetwork {
                                                val response = fetch(provider, stream)
                                                val metadata = XtreamMetadataFallback.parseResponse(provider, stream, responseMap(response), if (kind == "series") "tv" else "movie")
                                                if (kind == "series") {
                                                    val parsed = SeriesEpisodeParser.parse(providerId, stream.remoteId, response)
                                                    check(parsed.payloadPresent) { "Invalid series response" }
                                                    // Empty is a valid provider response, not an excuse to fake an in-progress state.
                                                    dao.replaceEpisodes(providerId, stream.remoteId, parsed.episodes)
                                                } else {
                                                    check(response.isJsonObject && (response.asJsonObject.has("info") || response.asJsonObject.has("movie_data"))) { "Invalid movie response" }
                                                }
                                                ProviderMetadataCache.write(app, providerId, stream.key, metadata)
                                                if (metadata != null) db.openHelper.writableDatabase.execSQL(
                                                    "UPDATE streams SET icon=COALESCE(?,icon),backdrop=COALESCE(?,backdrop),plot=COALESCE(?,plot),genre=COALESCE(?,genre),releaseDate=COALESCE(?,releaseDate),rating=COALESCE(?,rating),duration=COALESCE(?,duration) WHERE `key`=?",
                                                    arrayOf(metadata.posterUrl, metadata.backdropUrl, metadata.overview,
                                                        metadata.genres.takeIf { it.isNotEmpty() }?.joinToString(", "), metadata.releaseDate,
                                                        metadata.rating?.toString(), metadata.runtimeMinutes?.toString(), stream.key)
                                                )
                                            }
                                            if (success) journal.complete(providerId, "detail", stream.key)
                                        }
                                    } }.awaitAll()
                                }
                                emit(PreparationProgress.Stage.DETAILS, "detail", "حفظ التفاصيل والمواسم والحلقات")
                            }
                        }
                    }
                    val (detailDone, detailTotal) = journal.counts(providerId, "detail")
                    if (detailDone != detailTotal) throw Incomplete(detailTotal - detailDone, 0)
                    CatalogSyncState.markMetadataReady(app, providerId)
                    CatalogSyncState.markEpisodesReady(app, providerId)
                    progress(Update(60, "إحصاء صور المكتبة من بيانات السيرفر..."))
                    // Durable URL list, not an in-memory list of all bitmaps or the whole catalog.
                    for (kind in listOf("live", "movie", "series")) pages(kind) { page ->
                        page.forEach { stream ->
                            val metadata = ProviderMetadataCache.read(app, stream.key)
                            val urls = buildList<String?> {
                                add(stream.icon); add(stream.backdrop)
                                add(metadata?.posterUrl); add(metadata?.backdropUrl); add(metadata?.logoUrl)
                                metadata?.cast?.forEach { add(it.profileUrl) }
                            }
                            urls.filterNotNull().map(String::trim).filter { it.isNotBlank() && it != "null" }.distinct().forEach { raw ->
                                val url = runCatching { java.net.URI(provider.baseUrl.trimEnd('/') + "/").resolve(raw).toString() }.getOrDefault(raw)
                                journal.enqueue(providerId, "art", PreparationJournal.hash(url), url)
                            }
                        }
                    }
                    var after = ""
                    while (true) {
                        val page = journal.imagePage(providerId, after)
                        if (page.isEmpty()) break
                        page.chunked(4).forEach { group ->
                            coroutineScope {
                                group.map { (key, url) -> async {
                                    // Also verify old success markers: storage may have been manually cleared.
                                    if (!ArtworkLoader.isPersisted(app, url)) {
                                        val ok = retryNetwork { check(ArtworkLoader.persist(app, url)) { "Image unavailable" } }
                                        if (ok) journal.complete(providerId, "art", key)
                                        else journal.reopen(providerId, "art", key)
                                    } else journal.complete(providerId, "art", key)
                                } }.awaitAll()
                            }
                            emit(PreparationProgress.Stage.ARTWORK, "art", "حفظ صور المكتبة")
                        }
                        after = page.last().first
                    }
                    val (artDone, artTotal) = journal.counts(providerId, "art")
                    if (artDone != artTotal) throw Incomplete(0, artTotal - artDone)
                    progress(Update(95, "تجهيز الرئيسية من التخزين المحلي..."))
                    HomeSnapshotStore.rebuild(app, dao, provider)
                    progress(Update(97, "تجهيز البحث المحلي..."))
                    dao.rebuildSearchIndex(providerId)
                    app.getSharedPreferences("blofy_search_index", Context.MODE_PRIVATE).edit().putBoolean("v9_ready_$providerId", true).commit()
                    progress(Update(98, "التحقق من اكتمال التخزين..."))
                    CatalogManifestStore.rebuild(app, dao, provider, completionVerified = true)
                    ensureCurrentSource()
                    CatalogSyncState.markFullyReady(app, providerId, expectedEpoch)
                    check(CatalogSyncState.isFullyReady(app, providerId))
                    progress(Update(100, "اكتمل حفظ المكتبة • جاهزة للفتح"))
                }
            }
        }

    private suspend fun fetch(provider: ProviderEntity, stream: StreamEntity): JsonElement {
        val series = stream.kind == "series"
        val url = (provider.baseUrl.trimEnd('/') + "/player_api.php").toHttpUrl().newBuilder()
            .addQueryParameter("username", provider.username).addQueryParameter("password", provider.password)
            .addQueryParameter("action", if (series) "get_series_info" else "get_vod_info")
            .addQueryParameter(if (series) "series_id" else "vod_id", SeriesEpisodeParser.normalizeSeriesIdForRequest(stream.remoteId))
            .build().toString()
        return withTimeout(18_000L) { XtreamClient.api.jsonResponse(url) }
    }
    @Suppress("UNCHECKED_CAST")
    private fun responseMap(response: JsonElement): Map<String, Any?> =
        if (response.isJsonObject) gson.fromJson(response, Map::class.java) as Map<String, Any?> else emptyMap()

    /** Retry only fetch/decode failures. Storage failures must be actionable, never reported as saved. */
    private suspend fun retryNetwork(block: suspend () -> Unit): Boolean {
        repeat(2) {
            currentCoroutineContext().ensureActive()
            try { block(); return true }
            catch (_: TimeoutCancellationException) { currentCoroutineContext().ensureActive() }
            catch (cancelled: CancellationException) { throw cancelled }
            catch (error: android.database.sqlite.SQLiteException) { throw error }
            catch (error: ArtworkLoader.StorageFull) { throw error }
            catch (_: Exception) { /* Sanitized aggregate is shown; never display raw credential URLs. */ }
        }
        return false
    }
}
