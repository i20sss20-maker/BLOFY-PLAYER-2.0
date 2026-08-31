package tv.blofy.player.data

import com.google.gson.Gson
import com.google.gson.reflect.TypeToken
import com.google.gson.stream.JsonReader
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.flow.first
import tv.blofy.player.data.local.BlofyDao
import tv.blofy.player.data.local.CategoryEntity
import tv.blofy.player.data.local.EpgEntity
import tv.blofy.player.data.local.EpisodeEntity
import tv.blofy.player.data.local.ProviderEntity
import tv.blofy.player.data.local.StreamEntity
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
                    freshItemCount += syncLive(provider)
                },
                suspend {
                    onProgress(PlaylistSyncProgress(PlaylistSyncStage.MOVIES, 2, 3))
                    freshItemCount += syncVod(provider) { percent ->
                        onProgress(PlaylistSyncProgress(PlaylistSyncStage.MOVIES, 2, 3, percent))
                    }
                },
                suspend {
                    onProgress(PlaylistSyncProgress(PlaylistSyncStage.SERIES, 3, 3))
                    freshItemCount += syncSeries(provider)
                }
            )
        )
        return PlaylistSyncResult(
            freshItemCount = freshItemCount,
            failedSectionCount = sectionResult.failureCount
        )
    }

    private suspend fun syncM3u(provider: ProviderEntity): Int {
        val parsed = m3uLoader.load(provider)
        val previous = listOf("live", "movie", "series").flatMap { kind ->
            dao.streams(provider.id, kind, null).first()
        }
        val streams = PreviousStreamFlags(previous).applyTo(parsed.streams)

        if (!CatalogReplacementPolicy.shouldReplace(
                previousStreamCount = previous.size,
                sourceCategoryCount = parsed.categories.size,
                parsedCategoryCount = parsed.categories.size,
                sourceStreamCount = parsed.streams.size,
                parsedStreamCount = streams.size
            )
        ) return 0
        dao.replaceM3uCatalog(provider.id, parsed.categories, streams, parsed.episodes)
        return streams.size
    }

    suspend fun syncLive(provider: ProviderEntity): Int {
        if (provider.providerType.equals("m3u", true)) return 0
        val categories = api.list(actionUrl(provider, "get_live_categories"))
        val streams = api.list(actionUrl(provider, "get_live_streams"))
        val previous = dao.streams(provider.id, "live", null).first()
        val previousFlags = PreviousStreamFlags(previous)
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
        val streamRows = streams.mapIndexedNotNull { index, row ->
            if (index % 256 == 0) coroutineContext.ensureActive()
            val id = row.id("stream_id") ?: return@mapIndexedNotNull null
            val key = "${provider.id}:live:$id"
            val archive = row.string("tv_archive").let { it == "1" || it.equals("true", true) }
            StreamEntity(
                key = key,
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
        }

        val preservedRows = previousFlags.applyTo(streamRows)
        if (CatalogReplacementPolicy.shouldReplace(
                previousStreamCount = previous.size,
                sourceCategoryCount = categories.size,
                parsedCategoryCount = categoryRows.size,
                sourceStreamCount = streams.size,
                parsedStreamCount = preservedRows.size
            )
        ) {
            dao.replaceCatalog(provider.id, "live", categoryRows, preservedRows)
        }
        return preservedRows.size
    }

    /**
     * VOD is intentionally parsed as a streaming JSON array. Large providers can return tens of
     * thousands of movies and buffering `List<Map<...>>` plus the converted entity list at the
     * same time creates a very large memory spike on Android TV devices.
     */
    suspend fun syncVod(
        provider: ProviderEntity,
        onProgress: suspend (Int) -> Unit = {}
    ): Int {
        if (provider.providerType.equals("m3u", true)) return 0
        val categories = api.list(actionUrl(provider, "get_vod_categories"))
        val (previousCount, previousFlags) = dao.streams(provider.id, "movie", null).first().let { previous ->
            previous.size to PreviousStreamFlags(previous.filter { it.favorite || it.locked })
        }
        val coroutineContext = currentCoroutineContext()
        val categoryRows = categories.mapIndexedNotNull { index, row ->
            if (index % 256 == 0) coroutineContext.ensureActive()
            val id = row.id("category_id") ?: return@mapIndexedNotNull null
            CategoryEntity("${provider.id}:movie:$id", provider.id, id, "movie", row.string("category_name") ?: "Movies", index)
        }

        val streamRows = ArrayList<StreamEntity>(4096)
        var sourceStreamCount = 0
        val body = api.streamingResponse(actionUrl(provider, "get_vod_streams"))
        val declaredBytes = body.contentLength()
        body.use { responseBody ->
            val counting = CountingInputStream(responseBody.byteStream())
            JsonReader(InputStreamReader(counting, Charsets.UTF_8)).use { reader ->
                reader.beginArray()
                val gson = Gson()
                val mapType = object : TypeToken<Map<String, Any?>>() {}.type
                while (reader.hasNext()) {
                    if (sourceStreamCount % 128 == 0) coroutineContext.ensureActive()
                    val row: Map<String, Any?> = gson.fromJson(reader, mapType)
                    sourceStreamCount += 1
                    vodEntity(provider, row)?.let { streamRows += previousFlags.applyTo(it) }

                    if (sourceStreamCount % 256 == 0) {
                        val percent = if (declaredBytes > 0L) {
                            60 + ((counting.bytesRead.toDouble() / declaredBytes.toDouble()) * 28.0).toInt().coerceIn(0, 28)
                        } else {
                            60 + (sourceStreamCount / 500).coerceIn(0, 27)
                        }
                        onProgress(percent.coerceIn(60, 88))
                    }
                }
                reader.endArray()
            }
        }
        onProgress(88)

        if (CatalogReplacementPolicy.shouldReplace(
                previousStreamCount = previousCount,
                sourceCategoryCount = categories.size,
                parsedCategoryCount = categoryRows.size,
                sourceStreamCount = sourceStreamCount,
                parsedStreamCount = streamRows.size
            )
        ) {
            dao.replaceCatalog(provider.id, "movie", categoryRows, streamRows)
        }
        return streamRows.size
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

    suspend fun syncSeries(provider: ProviderEntity): Int {
        if (provider.providerType.equals("m3u", true)) return 0
        val categories = api.list(actionUrl(provider, "get_series_categories"))
        val series = api.list(actionUrl(provider, "get_series"))
        val previous = dao.streams(provider.id, "series", null).first()
        val previousFlags = PreviousStreamFlags(previous)
        val coroutineContext = currentCoroutineContext()
        val categoryRows = categories.mapIndexedNotNull { index, row ->
            if (index % 256 == 0) coroutineContext.ensureActive()
            val id = row.id("category_id") ?: return@mapIndexedNotNull null
            CategoryEntity("${provider.id}:series:$id", provider.id, id, "series", row.string("category_name") ?: "Series", index)
        }
        val streamRows = series.mapIndexedNotNull { index, row ->
            if (index % 256 == 0) coroutineContext.ensureActive()
            val id = row.id("series_id") ?: return@mapIndexedNotNull null
            val key = "${provider.id}:series:$id"
            val backdrop = when (val raw = row["backdrop_path"]) {
                is List<*> -> raw.firstOrNull()?.toString()
                else -> raw?.toString()
            }
            StreamEntity(
                key = key,
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
        }
        val preservedRows = previousFlags.applyTo(streamRows)
        if (CatalogReplacementPolicy.shouldReplace(
                previousStreamCount = previous.size,
                sourceCategoryCount = categories.size,
                parsedCategoryCount = categoryRows.size,
                sourceStreamCount = series.size,
                parsedStreamCount = preservedRows.size
            )
        ) {
            dao.replaceCatalog(provider.id, "series", categoryRows, preservedRows)
        }
        return preservedRows.size
    }

    suspend fun syncSeriesEpisodes(provider: ProviderEntity, seriesId: String): SeriesEpisodeSyncResult {
        if (provider.providerType.equals("m3u", true)) {
            val cached = dao.episodes(provider.id, seriesId).first()
            return SeriesEpisodeSyncResult(cached.size, payloadPresent = true, cacheUpdated = false)
        }

        val requestSeriesId = SeriesEpisodeParser.normalizeSeriesIdForRequest(seriesId)
        val response = api.jsonResponse(
            actionUrl(provider, "get_series_info", mapOf("series_id" to requestSeriesId))
        )
        val parsed = SeriesEpisodeParser.parse(provider.id, seriesId, response)

        if (parsed.episodes.isNotEmpty()) {
            dao.replaceEpisodes(provider.id, seriesId, parsed.episodes)
        }
        return SeriesEpisodeSyncResult(
            episodeCount = parsed.episodes.size,
            payloadPresent = parsed.payloadPresent,
            cacheUpdated = parsed.episodes.isNotEmpty()
        )
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

    private fun enc(value: String): String = URLEncoder.encode(value, StandardCharsets.UTF_8.name())
    private fun Map<String, Any?>.id(key: String): String? = XtreamIdentifier.normalize(this[key])
    private fun Map<String, Any?>.string(key: String): String? = this[key]?.toString()?.takeIf { it.isNotBlank() && it != "null" }
    private fun Map<*, *>.stringAny(key: String): String? = this[key]?.toString()?.takeIf { it.isNotBlank() && it != "null" }
    private fun Map<*, *>.intAny(key: String): Int? = stringAny(key)?.toIntOrNull()
    private fun Map<*, *>.longAny(key: String): Long? = stringAny(key)?.toLongOrNull()

    private fun decodeBase64OrRaw(value: String): String {
        if (value.isBlank()) return value
        return runCatching { String(android.util.Base64.decode(value, android.util.Base64.DEFAULT), Charsets.UTF_8).trim() }.getOrDefault(value)
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

/** Carries favorite/lock state across catalog refreshes and legacy identifier repair. */
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
        val flags = aliases(stream)
            .mapNotNull(byAlias::get)
            .fold(Flags(stream.favorite, stream.locked)) { combined, item -> combined.merge(item) }
        return stream.copy(favorite = flags.favorite, locked = flags.locked)
    }

    fun applyTo(streams: List<StreamEntity>): List<StreamEntity> = streams.map(::applyTo)

    private fun aliases(stream: StreamEntity): Set<String> = buildSet {
        add("key:${stream.key}")
        add("id:${stream.kind}:${legacyCompatibleId(stream.remoteId)}")
        stream.key.substringAfterLast(':', missingDelimiterValue = "")
            .takeIf { it.isNotBlank() }
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

/** Rejects destructive replacement when a provider response is empty or could not be parsed. */
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

/** Lets an unavailable Xtream section fall back to its cache without blocking other sections. */
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
