package tv.blofy.player.data

import tv.blofy.player.data.local.BlofyDao
import tv.blofy.player.data.local.CategoryEntity
import tv.blofy.player.data.local.ProviderEntity
import tv.blofy.player.data.local.StreamEntity
import tv.blofy.player.data.remote.XtreamApi
import java.net.URLEncoder
import java.nio.charset.StandardCharsets

class PlaylistManager(
    private val api: XtreamApi,
    private val dao: BlofyDao
) {
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

    private fun actionUrl(provider: ProviderEntity, action: String): String {
        val base = provider.baseUrl.trim().trimEnd('/')
        return "$base/player_api.php?username=${enc(provider.username)}&password=${enc(provider.password)}&action=$action"
    }

    private fun enc(value: String): String = URLEncoder.encode(value, StandardCharsets.UTF_8.name())
    private fun Map<String, Any?>.string(key: String): String? = this[key]?.toString()?.takeIf { it.isNotBlank() && it != "null" }
}
