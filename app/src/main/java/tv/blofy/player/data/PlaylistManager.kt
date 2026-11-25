package tv.blofy.player.data

import com.google.gson.Gson
import com.google.gson.reflect.TypeToken
import com.google.gson.stream.JsonReader
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import tv.blofy.player.core.text.ArabicSearchNormalizer
import tv.blofy.player.data.local.BlofyDao
import tv.blofy.player.data.local.CategoryEntity
import tv.blofy.player.data.local.EpgEntity
import tv.blofy.player.BuildConfig
import tv.blofy.player.core.identity.StreamCodeSession
import tv.blofy.player.data.local.ProviderEntity
import tv.blofy.player.data.local.StreamEntity
import tv.blofy.player.data.local.StreamSearchFtsEntity
import tv.blofy.player.data.remote.XtreamApi
import tv.blofy.player.data.remote.ExternalXtreamCatalogTransport
import tv.blofy.player.core.identity.ExternalStreamConnectClient
import tv.blofy.player.data.remote.XtreamIdentifier
import tv.blofy.player.data.remote.readCatalog
import java.io.FilterInputStream
import java.io.InputStream
import java.io.InputStreamReader
import java.net.URLEncoder
import java.nio.charset.StandardCharsets

data class PlaylistSyncResult(
    val freshItemCount: Int,
    val failedSectionCount: Int = 0,
    val failureCode: String? = null
)

/** Xtream-only catalog synchronization for BLOFY rc07.12+. */
class PlaylistManager(
    private val api: XtreamApi,
    private val dao: BlofyDao,
    private val externalCatalog: Boolean = false,
    private val artworkCredentials: ExternalStreamConnectClient.Credentials? = null
) {
    private fun externalArtwork(vararg urls: String?): String? =
        urls.firstNotNullOfOrNull { tv.blofy.player.data.remote.ExternalArtworkPolicy.providerUrl(it, artworkCredentials) }

    suspend fun syncAll(
        provider: ProviderEntity,
        completedSections: Set<String> = emptySet(),
        onSectionComplete: suspend (String) -> Unit = {},
        onProgress: suspend (PlaylistSyncProgress) -> Unit = {}
    ): PlaylistSyncResult {
        require(provider.providerType.equals("xtream", true)) { "Xtream provider required" }
        require((externalCatalog && provider.baseUrl == ExternalXtreamCatalogTransport.ORIGIN &&
            provider.username.isEmpty() && provider.password.isEmpty()) ||
            (!externalCatalog && ((BuildConfig.CODE_ONLY_LOGIN && provider.baseUrl.trimEnd('/')==StreamCodeSession.HOST) ||
            (provider.username.isNotBlank() && provider.password.isNotBlank())))) {
            "Xtream credentials required"
        }

        var freshItemCount = 0
        val sectionResult = runXtreamSections(
            listOf(
                suspend {
                    onProgress(PlaylistSyncProgress(PlaylistSyncStage.LIVE, 1, 3))
                    freshItemCount += if ("live" in completedSections) dao.catalogCountAll(provider.id, "live") else syncLive(provider, onProgress = { percent ->
                        onProgress(PlaylistSyncProgress(PlaylistSyncStage.LIVE, 1, 3, percent))
                    })
                    onSectionComplete("live")
                },
                suspend {
                    onProgress(PlaylistSyncProgress(PlaylistSyncStage.MOVIES, 2, 3))
                    freshItemCount += if ("movie" in completedSections) dao.catalogCountAll(provider.id, "movie") else syncVod(
                        provider,
                        onProcessed = { count ->
                            onProgress(PlaylistSyncProgress(PlaylistSyncStage.MOVIES, 2, 3, processedItems = count))
                        },
                        onProgress = { percent ->
                            onProgress(PlaylistSyncProgress(PlaylistSyncStage.MOVIES, 2, 3, percent))
                        }
                    )
                    onSectionComplete("movie")
                },
                suspend {
                    onProgress(PlaylistSyncProgress(PlaylistSyncStage.SERIES, 3, 3))
                    freshItemCount += if ("series" in completedSections) dao.catalogCountAll(provider.id, "series") else syncSeries(
                        provider,
                        onProcessed = { count ->
                            onProgress(PlaylistSyncProgress(PlaylistSyncStage.SERIES, 3, 3, processedItems = count))
                        },
                        onProgress = { percent ->
                            onProgress(PlaylistSyncProgress(PlaylistSyncStage.SERIES, 3, 3, percent))
                        }
                    )
                    onSectionComplete("series")
                }
            ),
            preferSegmentation = externalCatalog,
            onRetry = { section, attempt ->
                val stage = listOf(PlaylistSyncStage.LIVE, PlaylistSyncStage.MOVIES, PlaylistSyncStage.SERIES)[section]
                onProgress(PlaylistSyncProgress(stage, section + 1, 3, retryAttempt = attempt))
            },
            onExhausted = { section, failure ->
                if (!CatalogSectionRetry.isRecoverableForSegmentation(failure)) false
                else {
                    // Full-catalog responses on some IPTV hosts are closed mid-transfer.
                    // After three ordinary retries, request the same section in smaller
                    // category chunks. Never count a partial chunk as successful.
                    when (section) {
                        0 -> {
                            onProgress(PlaylistSyncProgress(PlaylistSyncStage.LIVE, 1, 3, retryAttempt = 3))
                            freshItemCount += syncLive(provider, recoverByCategory = true) { percent ->
                                onProgress(PlaylistSyncProgress(PlaylistSyncStage.LIVE, 1, 3, percent))
                            }
                            onSectionComplete("live")
                        }
                        1 -> {
                            onProgress(PlaylistSyncProgress(PlaylistSyncStage.MOVIES, 2, 3, retryAttempt = 3))
                            freshItemCount += syncVod(provider, recoverByCategory = true,
                                onProcessed = { count ->
                                    onProgress(PlaylistSyncProgress(PlaylistSyncStage.MOVIES, 2, 3, processedItems = count))
                                }
                            ) { percent ->
                                onProgress(PlaylistSyncProgress(PlaylistSyncStage.MOVIES, 2, 3, percent))
                            }
                            onSectionComplete("movie")
                        }
                        else -> {
                            onProgress(PlaylistSyncProgress(PlaylistSyncStage.SERIES, 3, 3, retryAttempt = 3))
                            freshItemCount += syncSeries(provider, recoverByCategory = true,
                                onProcessed = { count ->
                                    onProgress(PlaylistSyncProgress(PlaylistSyncStage.SERIES, 3, 3, processedItems = count))
                                }
                            ) { percent ->
                                onProgress(PlaylistSyncProgress(PlaylistSyncStage.SERIES, 3, 3, percent))
                            }
                            onSectionComplete("series")
                        }
                    }
                    true
                }
            }
        )
        return PlaylistSyncResult(freshItemCount, sectionResult.failureCount, sectionResult.failureCode)
    }

    suspend fun syncLive(
        provider: ProviderEntity,
        recoverByCategory: Boolean = false,
        onProgress: suspend (Int) -> Unit = {}
    ): Int {
        val categories = api.list(actionUrl(provider, "get_live_categories"))
        val previousCount = dao.catalogCountAll(provider.id, "live")
        val previousFlags = PreviousStreamFlags(dao.persistedStreamFlags(provider.id, "live"))
        val coroutineContext = currentCoroutineContext()
        val categoryRows = categories.mapIndexedNotNull { index, row ->
            if (index % 256 == 0) coroutineContext.ensureActive()
            val id = row.id("category_id") ?: return@mapIndexedNotNull null
            CategoryEntity(
                key = "${provider.id}:live:$id",
                providerId = provider.id,
                remoteId = id,
                kind = "live",
                name = row.string("category_name") ?: "Live",
                orderIndex = index
            )
        }
        val direct = prepareDirectSectionIfEmpty(provider.id, "live", previousCount, categoryRows)
        val parsed = try {
            parseStreamingArray(
                actionUrl(provider, "get_live_streams"), 18, 30, onProgress,
                retainItems = !direct,
                onBatch = directBatchSink(direct),
                recoverCategoryIds = if (recoverByCategory) categoryRows.map { it.remoteId } else null
            ) { row ->
                val id = row.id("stream_id") ?: return@parseStreamingArray null
                val archive = row.string("tv_archive").let { it == "1" || it.equals("true", true) }
                previousFlags.applyTo(
                    StreamEntity(
                        key = "${provider.id}:live:$id",
                        providerId = provider.id,
                        remoteId = id,
                        categoryId = row.id("category_id"),
                        kind = "live",
                        name = row.string("name") ?: "Channel $id",
                        icon = if (externalCatalog) externalArtwork(row.string("stream_icon"), row.string("cover"), row.string("cover_big"), row.string("movie_image"), row.string("poster_path")) else row.string("stream_icon"),
                        directSource = if (externalCatalog) null else row.string("direct_source"),
                        epgChannelId = row.string("epg_channel_id"),
                        streamType = row.string("stream_type"),
                        archiveEnabled = archive,
                        archiveDurationDays = row.string("tv_archive_duration")?.toIntOrNull()?.coerceAtLeast(0) ?: 0,
                        favorite = false,
                        locked = false
                    )
                )
            }
        } catch (failure: Throwable) {
            if (direct) clearDirectSection(provider.id, "live")
            throw failure
        }
        finishSection(provider.id, "live", previousCount, categories.size, categoryRows, parsed, direct)
        onProgress(30)
        return parsed.itemCount
    }

    suspend fun syncVod(
        provider: ProviderEntity,
        recoverByCategory: Boolean = false,
        onProcessed: suspend (Int) -> Unit = {},
        onProgress: suspend (Int) -> Unit = {}
    ): Int {
        val categories = api.list(actionUrl(provider, "get_vod_categories"))
        val previousCount = dao.catalogCountAll(provider.id, "movie")
        val previousFlags = PreviousStreamFlags(dao.persistedStreamFlags(provider.id, "movie"))
        val coroutineContext = currentCoroutineContext()
        val categoryRows = categories.mapIndexedNotNull { index, row ->
            if (index % 256 == 0) coroutineContext.ensureActive()
            val id = row.id("category_id") ?: return@mapIndexedNotNull null
            CategoryEntity("${provider.id}:movie:$id", provider.id, id, "movie", row.string("category_name") ?: "Movies", index)
        }
        val direct = prepareDirectSectionIfEmpty(provider.id, "movie", previousCount, categoryRows)
        val parsed = try {
            parseStreamingArray(
                actionUrl(provider, "get_vod_streams"), 60, 88, onProgress,
                retainItems = !direct,
                onBatch = directBatchSink(direct),
                recoverCategoryIds = if (recoverByCategory) categoryRows.map { it.remoteId } else null,
                onProcessed = onProcessed
            ) { row -> vodEntity(provider, row)?.let(previousFlags::applyTo) }
        } catch (failure: Throwable) {
            if (direct) clearDirectSection(provider.id, "movie")
            throw failure
        }
        onProgress(88)
        finishSection(provider.id, "movie", previousCount, categories.size, categoryRows, parsed, direct)
        return parsed.itemCount
    }

    private fun vodEntity(provider: ProviderEntity, row: Map<String, Any?>): StreamEntity? {
        val id = row.id("stream_id") ?: return null
        val backdrop = when (val raw = row["backdrop_path"]) {
            is List<*> -> raw.firstOrNull()?.toString()
            else -> raw?.toString()
        }
        return StreamEntity(
            key = "${provider.id}:movie:$id",
            providerId = provider.id,
            remoteId = id,
            categoryId = row.id("category_id"),
            kind = "movie",
            name = row.string("name") ?: "Movie $id",
            icon = if (externalCatalog) externalArtwork(row.string("stream_icon"), row.string("cover"), row.string("cover_big"), row.string("movie_image"), row.string("poster_path")) else row.string("stream_icon"),
            extension = row.string("container_extension") ?: "mp4",
            directSource = if (externalCatalog) null else row.string("direct_source"),
            addedAt = row.string("added")?.toLongOrNull(),
            plot = row.string("plot") ?: row.string("description"),
            genre = row.string("genre"),
            releaseDate = row.string("releaseDate") ?: row.string("release_date"),
            year = row.string("year"),
            rating = row.string("rating") ?: row.string("rating_5based"),
            duration = row.string("duration"),
            backdrop = if (externalCatalog) externalArtwork(backdrop, row.string("backdrop"), row.string("backdrop_url")) else backdrop?.takeIf { it.isNotBlank() && it != "null" },
            favorite = false,
            locked = false
        )
    }

    suspend fun syncSeries(
        provider: ProviderEntity,
        recoverByCategory: Boolean = false,
        onProcessed: suspend (Int) -> Unit = {},
        onProgress: suspend (Int) -> Unit = {}
    ): Int {
        val categories = api.list(actionUrl(provider, "get_series_categories"))
        val previousCount = dao.catalogCountAll(provider.id, "series")
        val previousFlags = PreviousStreamFlags(dao.persistedStreamFlags(provider.id, "series"))
        val coroutineContext = currentCoroutineContext()
        val categoryRows = categories.mapIndexedNotNull { index, row ->
            if (index % 256 == 0) coroutineContext.ensureActive()
            val id = row.id("category_id") ?: return@mapIndexedNotNull null
            CategoryEntity("${provider.id}:series:$id", provider.id, id, "series", row.string("category_name") ?: "Series", index)
        }
        val direct = prepareDirectSectionIfEmpty(provider.id, "series", previousCount, categoryRows)
        val parsed = try {
            parseStreamingArray(
                actionUrl(provider, "get_series"), 88, 95, onProgress,
                retainItems = !direct,
                onBatch = directBatchSink(direct),
                onProcessed = onProcessed,
                recoverCategoryIds = if (recoverByCategory) categoryRows.map { it.remoteId } else null
            ) { row ->
                val id = row.id("series_id") ?: return@parseStreamingArray null
                val backdrop = when (val raw = row["backdrop_path"]) {
                    is List<*> -> raw.firstOrNull()?.toString()
                    else -> raw?.toString()
                }
                previousFlags.applyTo(
                    StreamEntity(
                        key = "${provider.id}:series:$id",
                        providerId = provider.id,
                        remoteId = id,
                        categoryId = row.id("category_id"),
                        kind = "series",
                        name = row.string("name") ?: "Series $id",
                        icon = if (externalCatalog) externalArtwork(row.string("cover"), row.string("cover_big"), row.string("stream_icon"), row.string("poster_path"), row.string("movie_image")) else row.string("cover") ?: row.string("stream_icon"),
                        addedAt = row.string("last_modified")?.toLongOrNull() ?: row.string("added")?.toLongOrNull(),
                        plot = row.string("plot") ?: row.string("description"),
                        genre = row.string("genre"),
                        releaseDate = row.string("releaseDate") ?: row.string("release_date"),
                        year = row.string("year"),
                        rating = row.string("rating") ?: row.string("rating_5based"),
                        duration = row.string("episode_run_time") ?: row.string("duration"),
                        backdrop = if (externalCatalog) externalArtwork(backdrop, row.string("backdrop"), row.string("backdrop_url")) else backdrop?.takeIf { it.isNotBlank() && it != "null" },
                        favorite = false,
                        locked = false
                    )
                )
            }
        } catch (failure: Throwable) {
            if (direct) clearDirectSection(provider.id, "series")
            throw failure
        }
        finishSection(provider.id, "series", previousCount, categories.size, categoryRows, parsed, direct)
        onProgress(95)
        return parsed.itemCount
    }

    private suspend fun prepareDirectSectionIfEmpty(
        providerId: String,
        kind: String,
        previousCount: Int,
        categories: List<CategoryEntity>
    ): Boolean {
        if (previousCount != 0 || dao.categorySnapshot(providerId, kind).isNotEmpty()) return false
        dao.clearCategories(providerId, kind)
        dao.clearStreams(providerId, kind)
        dao.clearSearchIndex(providerId, kind)
        categories.asSequence().chunked(DIRECT_CATEGORY_BATCH).forEach { batch ->
            if (batch.isNotEmpty()) dao.upsertCategories(batch)
        }
        return true
    }

    private fun directBatchSink(enabled: Boolean): suspend (List<StreamEntity>) -> Unit = { batch ->
        if (enabled && batch.isNotEmpty()) {
            dao.insertCatalogBatch(batch, batch.map(::searchRow))
        }
    }

    private suspend fun clearDirectSection(providerId: String, kind: String) {
        dao.clearSearchIndex(providerId, kind)
        dao.clearStreams(providerId, kind)
        dao.clearCategories(providerId, kind)
    }

    private suspend fun finishSection(
        providerId: String,
        kind: String,
        previousCount: Int,
        sourceCategoryCount: Int,
        categoryRows: List<CategoryEntity>,
        parsed: StreamingParseResult<StreamEntity>,
        direct: Boolean
    ) {
        val accepted = CatalogReplacementPolicy.shouldReplace(
            previousStreamCount = previousCount,
            sourceCategoryCount = sourceCategoryCount,
            parsedCategoryCount = categoryRows.size,
            sourceStreamCount = parsed.sourceCount,
            parsedStreamCount = parsed.itemCount
        )
        if (!accepted) {
            if (direct) clearDirectSection(providerId, kind)
            throw IllegalStateException("Incomplete $kind catalog section")
        }
        if (!direct) dao.replaceCatalog(providerId, kind, categoryRows, parsed.items)
    }

    private data class StreamingParseResult<T>(
        val sourceCount: Int,
        val itemCount: Int,
        val items: List<T>
    )

    private suspend fun <T> parseStreamingArray(
        url: String,
        progressStart: Int,
        progressEnd: Int,
        onProgress: suspend (Int) -> Unit,
        retainItems: Boolean = true,
        onBatch: suspend (List<T>) -> Unit = {},
        recoverCategoryIds: List<String>? = null,
        onProcessed: suspend (Int) -> Unit = {},
        map: (Map<String, Any?>) -> T?,
    ): StreamingParseResult<T> {
        if (recoverCategoryIds != null) {
            return parseSegmentedArray(url, recoverCategoryIds, progressStart, progressEnd,
                onProgress, retainItems, onBatch, onProcessed, map)
        }
        val coroutineContext = currentCoroutineContext()
        val items = if (retainItems) ArrayList<T>(4096) else null
        val batch = ArrayList<T>(DIRECT_STREAM_BATCH)
        var sourceCount = 0
        var itemCount = 0
        api.streamingCall(url).readCatalog { responseBody ->
            val declaredBytes = responseBody.contentLength()
            val counting = CountingInputStream(responseBody.byteStream())
            JsonReader(InputStreamReader(counting, Charsets.UTF_8)).use { reader ->
                reader.beginArray()
                val gson = Gson()
                val mapType = object : TypeToken<Map<String, Any?>>() {}.type
                while (reader.hasNext()) {
                    if (sourceCount % 128 == 0) coroutineContext.ensureActive()
                    val row: Map<String, Any?> = gson.fromJson(reader, mapType)
                    sourceCount += 1
                    val converted = map(row)
                    if (converted != null) {
                        itemCount += 1
                        items?.add(converted)
                        if (!retainItems) {
                            batch += converted
                            if (batch.size >= DIRECT_STREAM_BATCH) {
                                onBatch(batch.toList())
                                batch.clear()
                            }
                        }
                    }
                    if (sourceCount % 256 == 0) {
                        val span = (progressEnd - progressStart).coerceAtLeast(1)
                        val fraction = if (declaredBytes > 0L) {
                            (counting.bytesRead.toDouble() / declaredBytes.toDouble()).coerceIn(0.0, 1.0)
                        } else {
                            (sourceCount.toDouble() / (sourceCount + 2000.0)).coerceIn(0.0, 0.96)
                        }
                        onProgress(progressStart + (fraction * span).toInt())
                        onProcessed(sourceCount)
                    }
                }
                reader.endArray()
            }
        }
        if (!retainItems && batch.isNotEmpty()) onBatch(batch.toList())
        if (sourceCount % 256 != 0) onProcessed(sourceCount)
        return StreamingParseResult(sourceCount, itemCount, items ?: emptyList())
    }

    /**
     * A fallback for Xtream providers which truncate very large uncompressed JSON arrays.
     * Each category MUST be returned by the source with matching category_id; providers
     * ignoring the query parameter fail closed instead of silently importing partial lists.
     * Existing rows are only replaced after every category, including uncategorized (0),
     * has been completely consumed and validated. Individual chunks retry independently.
     */
    private suspend fun <T> parseSegmentedArray(
        url: String,
        categoryIds: List<String>,
        progressStart: Int,
        progressEnd: Int,
        onProgress: suspend (Int) -> Unit,
        retainItems: Boolean,
        onBatch: suspend (List<T>) -> Unit,
        onProcessed: suspend (Int) -> Unit,
        map: (Map<String, Any?>) -> T?
    ): StreamingParseResult<T> {
        val categories = (categoryIds.filter { it.isNotBlank() } + "0").distinct()
        check(categories.size in 2..MAX_RECOVERY_CATEGORIES) {
            "Catalog provider does not support safe category recovery"
        }
        val items = if (retainItems) ArrayList<T>() else null
        var sourceCount = 0
        var itemCount = 0
        categories.forEachIndexed { index, categoryId ->
            currentCoroutineContext().ensureActive()
            val span = progressEnd - progressStart
            val start = progressStart + (span * index / categories.size)
            val end = progressStart + (span * (index + 1) / categories.size)
            val chunk = CatalogSectionRetry.run {
                parseStreamingArray(
                    "$url&category_id=${enc(categoryId)}",
                    start, end, onProgress, retainItems, onBatch,
                    onProcessed = { categoryCount -> onProcessed(sourceCount + categoryCount) }
                ) { row ->
                    val actualCategory = row.id("category_id") ?: if (categoryId == "0") "0" else null
                    check(actualCategory == categoryId) {
                        "Catalog provider did not honor its category filter"
                    }
                    map(row)
                }
            }
            sourceCount += chunk.sourceCount
            itemCount += chunk.itemCount
            items?.addAll(chunk.items)
            onProgress(end)
        }
        // An upstream that rejects category_id with an empty 200 response is not supported.
        // A no-content section should use the original unsegmented path instead.
        check(sourceCount > 0 && itemCount > 0) {
            "Catalog provider returned no complete categorized content"
        }
        return StreamingParseResult(sourceCount, itemCount, items ?: emptyList())
    }

    suspend fun syncSeriesEpisodes(
        provider: ProviderEntity, seriesId: String, preserveCachedRows: Boolean = false
    ): SeriesEpisodeSyncResult {
        val requestSeriesId = SeriesEpisodeParser.normalizeSeriesIdForRequest(seriesId)
        val response = api.jsonResponse(actionUrl(provider, "get_series_info", mapOf("series_id" to requestSeriesId)))
        val parsed = SeriesEpisodeParser.parse(provider.id, seriesId, response)
        val safeEpisodes = if (externalCatalog) parsed.episodes.map { it.copy(directSource = null) } else parsed.episodes
        if (safeEpisodes.isNotEmpty()) {
            val merged = if (preserveCachedRows) {
                SeriesEpisodeRetentionPolicy.preserveCached(
                    dao.episodeSnapshot(provider.id, seriesId), safeEpisodes
                )
            } else safeEpisodes
            dao.replaceEpisodes(provider.id, seriesId, merged)
        }
        return SeriesEpisodeSyncResult(parsed.episodes.size, parsed.payloadPresent, parsed.episodes.isNotEmpty())
    }

    suspend fun syncShortEpg(provider: ProviderEntity, streamId: String, limit: Int = 20) {
        val response = api.objectResponse(actionUrl(provider, "get_short_epg", mapOf("stream_id" to streamId, "limit" to limit.toString())))
        val items = parseEpg(provider.id, streamId, response["epg_listings"] as? List<*> ?: emptyList<Any?>())
        dao.clearEpg(provider.id, streamId)
        dao.upsertEpg(items)
    }

    suspend fun syncCatchupEpg(provider: ProviderEntity, streamId: String) {
        val response = api.objectResponse(actionUrl(provider, "get_simple_data_table", mapOf("stream_id" to streamId)))
        val rows = response["epg_listings"] as? List<*> ?: emptyList<Any?>()
        val items = parseEpg(provider.id, streamId, rows)
        dao.clearEpg(provider.id, streamId)
        dao.upsertEpg(items)
    }

    private fun parseEpg(providerId: String, streamId: String, rows: List<*>): List<EpgEntity> = rows.mapNotNull { raw ->
        val row = raw as? Map<*, *> ?: return@mapNotNull null
        val start = row.longAny("start_timestamp") ?: return@mapNotNull null
        val end = row.longAny("stop_timestamp") ?: return@mapNotNull null
        val title = decodeBase64OrRaw(row.stringAny("title") ?: "")
        val id = row.stringAny("id") ?: "$start-$end"
        EpgEntity(
            key = "$providerId:epg:$streamId:$id",
            providerId = providerId,
            streamId = streamId,
            title = title,
            description = decodeBase64OrRaw(row.stringAny("description") ?: "").takeIf { it.isNotBlank() },
            startMs = start * 1000L,
            endMs = end * 1000L
        )
    }

    private fun actionUrl(provider: ProviderEntity, action: String, extra: Map<String, String> = emptyMap()): String {
        val base = provider.baseUrl.trim().trimEnd('/')
        val tail = extra.entries.joinToString("") { "&${enc(it.key)}=${enc(it.value)}" }
        if (externalCatalog) {
            require(base == ExternalXtreamCatalogTransport.ORIGIN &&
                provider.username.isEmpty() && provider.password.isEmpty())
            return "$base/player_api.php?action=${enc(action)}$tail"
        }
        if (BuildConfig.CODE_ONLY_LOGIN && base==StreamCodeSession.HOST)
            return "$base/player_api.php?action=${enc(action)}$tail"
        return "$base/player_api.php?username=${enc(provider.username)}&password=${enc(provider.password)}&action=${enc(action)}$tail"
    }

    private fun searchRow(stream: StreamEntity) = StreamSearchFtsEntity(
        contentKey = stream.key,
        providerId = stream.providerId,
        kind = stream.kind,
        searchable = ArabicSearchNormalizer.searchable(
            stream.name, stream.genre, stream.year, stream.plot, stream.releaseDate, stream.streamType
        )
    )

    private fun enc(value: String): String = URLEncoder.encode(value, StandardCharsets.UTF_8.name())
    private fun Map<String, Any?>.id(key: String): String? = XtreamIdentifier.normalize(this[key])
    private fun Map<String, Any?>.string(key: String): String? = this[key]?.toString()?.takeIf { it.isNotBlank() && it != "null" }
    private fun Map<*, *>.stringAny(key: String): String? = this[key]?.toString()?.takeIf { it.isNotBlank() && it != "null" }
    private fun Map<*, *>.longAny(key: String): Long? = stringAny(key)?.toLongOrNull()

    private fun decodeBase64OrRaw(value: String): String {
        if (value.isBlank()) return value
        return runCatching { String(android.util.Base64.decode(value, android.util.Base64.DEFAULT), Charsets.UTF_8).trim() }.getOrDefault(value)
    }

    companion object {
        internal fun forProvider(
            context: android.content.Context,
            provider: ProviderEntity,
            dao: BlofyDao,
            episodeRequest: Boolean = false
        ): PlaylistManager {
            if (!BuildConfig.CODE_ONLY_LOGIN ||
                !tv.blofy.player.core.identity.NativeExternalMediaTransport.isExternal(provider.id)) {
                val api = if (episodeRequest) tv.blofy.player.data.remote.XtreamClient.episodeApi
                    else tv.blofy.player.data.remote.XtreamClient.api
                return PlaylistManager(api, dao)
            }
            check(provider.baseUrl == ExternalXtreamCatalogTransport.ORIGIN &&
                provider.username.isEmpty() && provider.password.isEmpty())
            val staged = checkNotNull(tv.blofy.player.core.identity.ExternalStreamConnectStore.loadStaged(context))
            check(staged.providerId == provider.id) { "External profile mismatch" }
            val client = ExternalXtreamCatalogTransport.client(staged.credentials)
            val api = tv.blofy.player.data.remote.XtreamClient.createApi(
                if (episodeRequest) tv.blofy.player.data.remote.XtreamClient.episodeClient(client) else client)
            return PlaylistManager(api, dao, externalCatalog = true, artworkCredentials = staged.credentials)
        }

        internal fun forExternal(credentials: ExternalStreamConnectClient.Credentials, dao: BlofyDao): PlaylistManager =
            PlaylistManager(ExternalXtreamCatalogTransport.api(credentials), dao, externalCatalog = true, artworkCredentials = credentials)

        const val DIRECT_STREAM_BATCH = 700
        const val DIRECT_CATEGORY_BATCH = 500
        const val MAX_RECOVERY_CATEGORIES = 501
    }
}

private class CountingInputStream(input: InputStream) : FilterInputStream(input) {
    var bytesRead: Long = 0L
        private set

    override fun read(): Int {
        val value = super.read()
        if (value >= 0) bytesRead += 1
        return value
    }

    override fun read(buffer: ByteArray, offset: Int, length: Int): Int {
        val count = super.read(buffer, offset, length)
        if (count > 0) bytesRead += count.toLong()
        return count
    }
}

internal class PreviousStreamFlags(previous: List<StreamEntity>) {
    private data class Flags(val favorite: Boolean = false, val locked: Boolean = false) {
        fun merge(other: Flags) = Flags(favorite || other.favorite, locked || other.locked)
    }

    private val byAlias = buildMap<String, Flags> {
        previous.forEach { stream ->
            val flags = Flags(stream.favorite, stream.locked)
            aliases(stream).forEach { alias -> put(alias, get(alias)?.merge(flags) ?: flags) }
        }
    }

    fun applyTo(stream: StreamEntity): StreamEntity {
        if (byAlias.isEmpty()) return stream
        val flags = aliases(stream).mapNotNull(byAlias::get)
            .fold(Flags(stream.favorite, stream.locked)) { combined, item -> combined.merge(item) }
        return stream.copy(favorite = flags.favorite, locked = flags.locked)
    }

    fun applyTo(streams: List<StreamEntity>): List<StreamEntity> = streams.map(::applyTo)

    private fun aliases(stream: StreamEntity): Set<String> = buildSet {
        add("key:${stream.key}")
        add("id:${stream.kind}:${legacyCompatibleId(stream.remoteId)}")
        stream.key.substringAfterLast(':', missingDelimiterValue = "").takeIf { it.isNotBlank() }
            ?.let { add("id:${stream.kind}:${legacyCompatibleId(it)}") }
    }

    companion object {
        private val LEGACY_DECIMAL_INTEGER = Regex("[+-]?\\d+\\.0+")
        internal fun legacyCompatibleId(value: String): String {
            val trimmed = value.trim()
            return if (LEGACY_DECIMAL_INTEGER.matches(trimmed)) trimmed.substringBefore('.') else trimmed
        }
    }
}

internal object CatalogReplacementPolicy {
    fun shouldReplace(
        previousStreamCount: Int,
        sourceCategoryCount: Int,
        parsedCategoryCount: Int,
        sourceStreamCount: Int,
        parsedStreamCount: Int
    ): Boolean {
        if (sourceCategoryCount > 0 && parsedCategoryCount == 0) return false
        if (sourceStreamCount > 0 && parsedStreamCount == 0) return false
        if (previousStreamCount > 0 && parsedStreamCount == 0) return false
        return true
    }
}

internal data class XtreamSectionResult(
    val successCount: Int,
    val failureCount: Int,
    val failureCode: String? = null
)

internal suspend fun runXtreamSections(
    sections: List<suspend () -> Unit>,
    onRetry: suspend (Int, Int) -> Unit = { _, _ -> },
    onExhausted: suspend (Int, Exception) -> Boolean = { _, _ -> false },
    preferSegmentation: Boolean = false
): XtreamSectionResult {
    require(sections.isNotEmpty()) { "At least one Xtream section is required" }
    var successCount = 0
    val failures = mutableListOf<Exception>()
    sections.forEachIndexed { index, syncSection ->
        try {
            CatalogSectionRetry.run(onRetry = { onRetry(index, it) },
                preferSegmentation = preferSegmentation, block = syncSection)
            successCount += 1
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (failure: Exception) {
            try {
                if (onExhausted(index, failure)) successCount += 1
                else failures += failure
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (recoveryFailure: Exception) {
                recoveryFailure.addSuppressed(failure)
                failures += recoveryFailure
            }
        }
    }
    if (successCount == 0) {
        val first = failures.firstOrNull() ?: IllegalStateException("All Xtream sections failed")
        failures.drop(1).forEach(first::addSuppressed)
        throw first
    }
    // A partial refresh must retain the actual failed section's error category.
    // Otherwise one successful section silently masks a 401/timeout/invalid reply.
    return XtreamSectionResult(successCount, failures.size,
        failures.firstOrNull()?.let(CatalogRefreshFailureReason::code))
}
