package tv.blofy.player.data

import com.google.gson.Gson
import com.google.gson.reflect.TypeToken
import com.google.gson.stream.JsonReader
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.flow.first
import tv.blofy.player.core.text.ArabicSearchNormalizer
import tv.blofy.player.data.local.BlofyDao
import tv.blofy.player.data.local.CategoryEntity
import tv.blofy.player.data.local.EpgEntity
import tv.blofy.player.data.local.EpisodeEntity
import tv.blofy.player.data.local.ProviderEntity
import tv.blofy.player.data.local.StreamEntity
import tv.blofy.player.data.local.StreamSearchFtsEntity
import tv.blofy.player.data.m3u.M3uPlaylistLoader
import tv.blofy.player.data.remote.XtreamApi
import tv.blofy.player.data.remote.XtreamIdentifier
import java.io.FilterInputStream
import java.io.InputStream
import java.io.InputStreamReader
import java.net.URLEncoder
import java.nio.charset.StandardCharsets

data class PlaylistSyncResult(
    val freshItemCount: Int,
    val failedSectionCount: Int = 0
)

class PlaylistManager(
    private val api: XtreamApi,
    private val dao: BlofyDao,
    private val m3uLoader: M3uPlaylistLoader = M3uPlaylistLoader()
) {
    suspend fun syncAll(
        provider: ProviderEntity,
        onProgress: suspend (PlaylistSyncProgress) -> Unit = {}
    ): PlaylistSyncResult {
        if (provider.providerType.equals("m3u", true)) {
            onProgress(PlaylistSyncProgress(PlaylistSyncStage.M3U, 1, 1))
            return PlaylistSyncResult(syncM3u(provider))
        }
        var freshItemCount = 0
        val sectionResult = runXtreamSections(
            listOf(
                suspend {
                    onProgress(PlaylistSyncProgress(PlaylistSyncStage.LIVE, 1, 3))
                    freshItemCount += syncLive(provider) { percent ->
                        onProgress(PlaylistSyncProgress(PlaylistSyncStage.LIVE, 1, 3, percent))
                    }
                },
                suspend {
                    onProgress(PlaylistSyncProgress(PlaylistSyncStage.MOVIES, 2, 3))
                    freshItemCount += syncVod(provider) { percent ->
                        onProgress(PlaylistSyncProgress(PlaylistSyncStage.MOVIES, 2, 3, percent))
                    }
                },
                suspend {
                    onProgress(PlaylistSyncProgress(PlaylistSyncStage.SERIES, 3, 3))
                    freshItemCount += syncSeries(provider) { percent ->
                        onProgress(PlaylistSyncProgress(PlaylistSyncStage.SERIES, 3, 3, percent))
                    }
                }
            )
        )
        return PlaylistSyncResult(
            freshItemCount = freshItemCount,
            failedSectionCount = sectionResult.failureCount
        )
    }

    private suspend fun syncM3u(provider: ProviderEntity): Int {
        val kinds = listOf("live", "movie", "series")
        var previousCount = 0
        var hasExistingCategories = false
        for (kind in kinds) {
            previousCount += dao.catalogCountAll(provider.id, kind)
            if (!hasExistingCategories && dao.categorySnapshot(provider.id, kind).isNotEmpty()) {
                hasExistingCategories = true
            }
        }

        // Fresh providers and staged refresh providers have no known-good rows under their own ID.
        // Stream them directly into Room so a huge M3U never becomes one giant String/List in RAM.
        if (previousCount == 0 && !hasExistingCategories) {
            dao.clearProviderCatalog(provider.id)
            return try {
                val summary = m3uLoader.loadStreaming(
                    provider = provider,
                    onStreamBatch = { batch ->
                        if (batch.isNotEmpty()) dao.upsertStreams(batch)
                    },
                    onEpisodeBatch = { batch ->
                        if (batch.isNotEmpty()) dao.upsertEpisodes(batch)
                    },
                )
                summary.categories.asSequence().chunked(DIRECT_CATEGORY_BATCH).forEach { batch ->
                    if (batch.isNotEmpty()) dao.upsertCategories(batch)
                }

                var storedCount = 0
                for (kind in kinds) storedCount += dao.catalogCountAll(provider.id, kind)
                val accepted = CatalogReplacementPolicy.shouldReplace(
                    previousStreamCount = 0,
                    sourceCategoryCount = summary.categories.size,
                    parsedCategoryCount = summary.categories.size,
                    sourceStreamCount = summary.streamCount,
                    parsedStreamCount = storedCount,
                )
                if (!accepted || storedCount <= 0) {
                    dao.clearProviderCatalog(provider.id)
                    return 0
                }

                // Build search from bounded Room pages after the durable catalog is present. This
                // avoids retaining a second 100k+ FTS list while network data is still arriving.
                dao.rebuildSearchIndex(provider.id)
                storedCount
            } catch (failure: Throwable) {
                runCatching { dao.clearProviderCatalog(provider.id) }
                throw failure
            }
        }

        // Compatibility path for an in-place M3U sync. Normal refreshes are staged by
        // CatalogRefreshWorker, so large production refreshes use the bounded path above.
        val parsed = m3uLoader.load(provider)
        val previousFlags = ArrayList<StreamEntity>()
        for (kind in kinds) previousFlags += dao.persistedStreamFlags(provider.id, kind)
        val streams = PreviousStreamFlags(previousFlags).applyTo(parsed.streams)

        if (!CatalogReplacementPolicy.shouldReplace(
                previousStreamCount = previousCount,
                sourceCategoryCount = parsed.categories.size,
                parsedCategoryCount = parsed.categories.size,
                sourceStreamCount = parsed.streams.size,
                parsedStreamCount = streams.size
            )
        ) return 0
        dao.replaceM3uCatalog(provider.id, parsed.categories, streams, parsed.episodes)
        return streams.size
    }

    suspend fun syncLive(
        provider: ProviderEntity,
        onProgress: suspend (Int) -> Unit = {}
    ): Int {
        if (provider.providerType.equals("m3u", true)) return 0
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
                onBatch = directBatchSink(direct)
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
                        icon = row.string("stream_icon"),
                        directSource = row.string("direct_source"),
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
        onProgress: suspend (Int) -> Unit = {}
    ): Int {
        if (provider.providerType.equals("m3u", true)) return 0
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
                onBatch = directBatchSink(direct)
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
            icon = row.string("stream_icon"),
            extension = row.string("container_extension") ?: "mp4",
            directSource = row.string("direct_source"),
            addedAt = row.string("added")?.toLongOrNull(),
            plot = row.string("plot") ?: row.string("description"),
            genre = row.string("genre"),
            releaseDate = row.string("releaseDate") ?: row.string("release_date"),
            year = row.string("year"),
            rating = row.string("rating") ?: row.string("rating_5based"),
            duration = row.string("duration"),
            backdrop = backdrop?.takeIf { it.isNotBlank() && it != "null" },
            favorite = false,
            locked = false
        )
    }

    suspend fun syncSeries(
        provider: ProviderEntity,
        onProgress: suspend (Int) -> Unit = {}
    ): Int {
        if (provider.providerType.equals("m3u", true)) return 0
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
                onBatch = directBatchSink(direct)
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
                        icon = row.string("cover") ?: row.string("stream_icon"),
                        addedAt = row.string("last_modified")?.toLongOrNull() ?: row.string("added")?.toLongOrNull(),
                        plot = row.string("plot") ?: row.string("description"),
                        genre = row.string("genre"),
                        releaseDate = row.string("releaseDate") ?: row.string("release_date"),
                        year = row.string("year"),
                        rating = row.string("rating") ?: row.string("rating_5based"),
                        duration = row.string("episode_run_time") ?: row.string("duration"),
                        backdrop = backdrop?.takeIf { it.isNotBlank() && it != "null" },
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
        // Fresh staged providers have no known-good rows. Store categories once, then stream rows
        // directly to Room instead of retaining a catalog-sized ArrayList in memory.
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
            dao.upsertStreams(batch)
            dao.insertSearchRows(batch.map(::searchRow))
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
            return
        }
        if (!direct) dao.replaceCatalog(providerId, kind, categoryRows, parsed.items)
    }

    private data class StreamingParseResult<T>(
        val sourceCount: Int,
        val itemCount: Int,
        val items: List<T>
    )

    /**
     * Streaming parser used by Live/VOD/Series. On a fresh staged section converted rows are flushed
     * directly to Room in bounded batches, so neither the raw JSON nor a second 100k+ entity list is
     * retained. Existing catalogs still retain the incoming list because diff replacement needs it.
     */
    private suspend fun <T> parseStreamingArray(
        url: String,
        progressStart: Int,
        progressEnd: Int,
        onProgress: suspend (Int) -> Unit,
        retainItems: Boolean = true,
        onBatch: suspend (List<T>) -> Unit = {},
        map: (Map<String, Any?>) -> T?,
    ): StreamingParseResult<T> {
        val coroutineContext = currentCoroutineContext()
        val items = if (retainItems) ArrayList<T>(4096) else null
        val batch = ArrayList<T>(DIRECT_STREAM_BATCH)
        var sourceCount = 0
        var itemCount = 0
        val body = api.streamingResponse(url)
        val declaredBytes = body.contentLength()
        body.use { responseBody ->
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
                    }
                }
                reader.endArray()
            }
        }
        if (!retainItems && batch.isNotEmpty()) onBatch(batch.toList())
        return StreamingParseResult(sourceCount, itemCount, items ?: emptyList())
    }

    suspend fun syncSeriesEpisodes(provider: ProviderEntity, seriesId: String): SeriesEpisodeSyncResult {
        if (provider.providerType.equals("m3u", true)) {
            val cached = dao.episodes(provider.id, seriesId).first()
            return SeriesEpisodeSyncResult(cached.size, payloadPresent = true, cacheUpdated = false)
        }
        val requestSeriesId = SeriesEpisodeParser.normalizeSeriesIdForRequest(seriesId)
        val response = api.jsonResponse(actionUrl(provider, "get_series_info", mapOf("series_id" to requestSeriesId)))
        val parsed = SeriesEpisodeParser.parse(provider.id, seriesId, response)
        if (parsed.episodes.isNotEmpty()) dao.replaceEpisodes(provider.id, seriesId, parsed.episodes)
        return SeriesEpisodeSyncResult(parsed.episodes.size, parsed.payloadPresent, parsed.episodes.isNotEmpty())
    }

    suspend fun syncShortEpg(provider: ProviderEntity, streamId: String, limit: Int = 20) {
        if (provider.providerType.equals("m3u", true)) return
        val response = api.objectResponse(actionUrl(provider, "get_short_epg", mapOf("stream_id" to streamId, "limit" to limit.toString())))
        val items = parseEpg(provider.id, streamId, response["epg_listings"] as? List<*> ?: emptyList<Any?>())
        dao.clearEpg(provider.id, streamId)
        dao.upsertEpg(items)
    }

    suspend fun syncCatchupEpg(provider: ProviderEntity, streamId: String) {
        if (provider.providerType.equals("m3u", true)) return
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

    private companion object {
        const val DIRECT_STREAM_BATCH = 700
        const val DIRECT_CATEGORY_BATCH = 500
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

internal data class XtreamSectionResult(val successCount: Int, val failureCount: Int)

internal suspend fun runXtreamSections(sections: List<suspend () -> Unit>): XtreamSectionResult {
    require(sections.isNotEmpty()) { "At least one Xtream section is required" }
    var successCount = 0
    val failures = mutableListOf<Exception>()
    sections.forEach { syncSection ->
        try {
            syncSection()
            successCount += 1
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (failure: Exception) {
            failures += failure
        }
    }
    if (successCount == 0) {
        val first = failures.firstOrNull() ?: IllegalStateException("All Xtream sections failed")
        failures.drop(1).forEach(first::addSuppressed)
        throw first
    }
    return XtreamSectionResult(successCount, failures.size)
}
