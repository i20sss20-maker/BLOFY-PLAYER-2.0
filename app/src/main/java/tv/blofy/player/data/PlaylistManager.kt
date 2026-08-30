package tv.blofy.player.data

import tv.blofy.player.data.local.BlofyDao
import tv.blofy.player.data.local.CategoryEntity
import tv.blofy.player.data.local.EpgEntity
import tv.blofy.player.data.local.EpisodeEntity
import tv.blofy.player.data.local.ProviderEntity
import tv.blofy.player.data.local.StreamEntity
import tv.blofy.player.data.remote.XtreamApi
import java.net.URLEncoder
import java.nio.charset.StandardCharsets

class PlaylistManager(
    private val api: XtreamApi,
    private val dao: BlofyDao
) {
    suspend fun syncAll(provider: ProviderEntity) {
        syncLive(provider)
        syncVod(provider)
        syncSeries(provider)
    }

    suspend fun syncLive(provider: ProviderEntity) {
        val categories = api.list(actionUrl(provider, "get_live_categories"))
        val streams = api.list(actionUrl(provider, "get_live_streams"))

        dao.clearCategories(provider.id, "live")
        dao.clearStreams(provider.id, "live")

        dao.upsertCategories(categories.mapIndexedNotNull { index, row ->
            val id = row.string("category_id") ?: return@mapIndexedNotNull null
            CategoryEntity(
                key = "${provider.id}:live:$id",
                providerId = provider.id,
                remoteId = id,
                kind = "live",
                name = row.string("category_name") ?: "Live",
                orderIndex = index
            )
        })

        dao.upsertStreams(streams.mapNotNull { row ->
            val id = row.string("stream_id") ?: return@mapNotNull null
            StreamEntity(
                key = "${provider.id}:live:$id",
                providerId = provider.id,
                remoteId = id,
                categoryId = row.string("category_id"),
                kind = "live",
                name = row.string("name") ?: "Channel $id",
                icon = row.string("stream_icon"),
                directSource = row.string("direct_source"),
                epgChannelId = row.string("epg_channel_id"),
                streamType = row.string("stream_type")
            )
        })
    }

    suspend fun syncVod(provider: ProviderEntity) {
        val categories = api.list(actionUrl(provider, "get_vod_categories"))
        val streams = api.list(actionUrl(provider, "get_vod_streams"))
        dao.clearCategories(provider.id, "movie")
        dao.clearStreams(provider.id, "movie")
        dao.upsertCategories(categories.mapIndexedNotNull { index, row ->
            val id = row.string("category_id") ?: return@mapIndexedNotNull null
            CategoryEntity("${provider.id}:movie:$id", provider.id, id, "movie", row.string("category_name") ?: "Movies", index)
        })
        dao.upsertStreams(streams.mapNotNull { row ->
            val id = row.string("stream_id") ?: return@mapNotNull null
            StreamEntity(
                key = "${provider.id}:movie:$id",
                providerId = provider.id,
                remoteId = id,
                categoryId = row.string("category_id"),
                kind = "movie",
                name = row.string("name") ?: "Movie $id",
                icon = row.string("stream_icon"),
                extension = row.string("container_extension") ?: "mp4",
                directSource = row.string("direct_source")
            )
        })
    }

    suspend fun syncSeries(provider: ProviderEntity) {
        val categories = api.list(actionUrl(provider, "get_series_categories"))
        val series = api.list(actionUrl(provider, "get_series"))
        dao.clearCategories(provider.id, "series")
        dao.clearStreams(provider.id, "series")
        dao.upsertCategories(categories.mapIndexedNotNull { index, row ->
            val id = row.string("category_id") ?: return@mapIndexedNotNull null
            CategoryEntity("${provider.id}:series:$id", provider.id, id, "series", row.string("category_name") ?: "Series", index)
        })
        dao.upsertStreams(series.mapNotNull { row ->
            val id = row.string("series_id") ?: return@mapNotNull null
            StreamEntity(
                key = "${provider.id}:series:$id",
                providerId = provider.id,
                remoteId = id,
                categoryId = row.string("category_id"),
                kind = "series",
                name = row.string("name") ?: "Series $id",
                icon = row.string("cover") ?: row.string("stream_icon")
            )
        })
    }

    suspend fun syncSeriesEpisodes(provider: ProviderEntity, seriesId: String) {
        val response = api.objectResponse(actionUrl(provider, "get_series_info", mapOf("series_id" to seriesId)))
        val groups = response["episodes"] as? Map<*, *> ?: emptyMap<Any?, Any?>()
        val episodes = buildList {
            groups.values.forEach { value ->
                val rows = value as? List<*> ?: return@forEach
                rows.forEach { raw ->
                    val row = raw as? Map<*, *> ?: return@forEach
                    val id = row.stringAny("id") ?: return@forEach
                    val season = row.intAny("season") ?: 0
                    val episode = row.intAny("episode_num") ?: row.intAny("episode") ?: 0
                    add(
                        EpisodeEntity(
                            key = "${provider.id}:episode:$id",
                            providerId = provider.id,
                            seriesId = seriesId,
                            remoteId = id,
                            season = season,
                            episode = episode,
                            title = row.stringAny("title") ?: "Episode $episode",
                            extension = row.stringAny("container_extension") ?: "mp4",
                            directSource = row.stringAny("direct_source"),
                            durationSecs = row.longAny("duration_secs")
                        )
                    )
                }
            }
        }
        dao.clearEpisodes(provider.id, seriesId)
        dao.upsertEpisodes(episodes.sortedWith(compareBy<EpisodeEntity> { it.season }.thenBy { it.episode }))
    }

    suspend fun syncShortEpg(provider: ProviderEntity, streamId: String, limit: Int = 20) {
        val response = api.objectResponse(
            actionUrl(provider, "get_short_epg", mapOf("stream_id" to streamId, "limit" to limit.toString()))
        )
        val rows = response["epg_listings"] as? List<*> ?: emptyList<Any?>()
        val items = rows.mapNotNull { raw ->
            val row = raw as? Map<*, *> ?: return@mapNotNull null
            val start = row.longAny("start_timestamp") ?: return@mapNotNull null
            val end = row.longAny("stop_timestamp") ?: return@mapNotNull null
            val title = decodeBase64OrRaw(row.stringAny("title") ?: "")
            val id = row.stringAny("id") ?: "$start-$end"
            EpgEntity(
                key = "${provider.id}:epg:$streamId:$id",
                providerId = provider.id,
                streamId = streamId,
                title = title,
                description = decodeBase64OrRaw(row.stringAny("description") ?: "").takeIf { it.isNotBlank() },
                startMs = start * 1000L,
                endMs = end * 1000L
            )
        }
        dao.clearEpg(provider.id, streamId)
        dao.upsertEpg(items)
    }

    private fun actionUrl(provider: ProviderEntity, action: String, extra: Map<String, String> = emptyMap()): String {
        val base = provider.baseUrl.trim().trimEnd('/')
        val tail = extra.entries.joinToString("") { "&${enc(it.key)}=${enc(it.value)}" }
        return "$base/player_api.php?username=${enc(provider.username)}&password=${enc(provider.password)}&action=${enc(action)}$tail"
    }

    private fun enc(value: String): String = URLEncoder.encode(value, StandardCharsets.UTF_8.name())
    private fun Map<String, Any?>.string(key: String): String? = this[key]?.toString()?.takeIf { it.isNotBlank() && it != "null" }
    private fun Map<*, *>.stringAny(key: String): String? = this[key]?.toString()?.takeIf { it.isNotBlank() && it != "null" }
    private fun Map<*, *>.intAny(key: String): Int? = stringAny(key)?.toIntOrNull()
    private fun Map<*, *>.longAny(key: String): Long? = stringAny(key)?.toLongOrNull()

    private fun decodeBase64OrRaw(value: String): String {
        if (value.isBlank()) return value
        return runCatching {
            String(android.util.Base64.decode(value, android.util.Base64.DEFAULT), Charsets.UTF_8).trim()
        }.getOrDefault(value)
    }
}
