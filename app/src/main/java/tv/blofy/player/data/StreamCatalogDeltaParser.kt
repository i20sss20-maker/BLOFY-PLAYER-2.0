package tv.blofy.player.data

import tv.blofy.player.data.local.CategoryEntity
import tv.blofy.player.data.local.StreamEntity
import tv.blofy.player.data.remote.XtreamIdentifier

/**
 * BLOFY STREAM's authenticated catalog delta uses the same numeric gateway IDs
 * as player_api.php. Keep local user state and cached metadata on changed rows.
 * No upstream host, user, password or media file is parsed here.
 */
internal object StreamCatalogDeltaParser {
    private fun Map<*, *>.text(key: String): String? =
        get(key)?.toString()?.trim()?.takeIf {
            it.isNotBlank() && !it.equals("null", true)
        }

    /** Source list fields vary between Xtream panels; preserve genuine art. */
    private fun Map<*, *>.artwork(vararg fields: String): String? =
        fields.firstNotNullOfOrNull { key -> text(key)?.takeIf {
            it.startsWith("https://", true) || it.startsWith("http://", true)
        } }

    fun category(providerId: String, kind: String, data: Map<*, *>,
                 old: CategoryEntity? = null, order: Int = 0): CategoryEntity? {
        if (providerId.isBlank() || kind !in setOf("live", "movie", "series")) return null
        val id = XtreamIdentifier.normalize(data["category_id"]) ?: return null
        val name = data.text("category_name") ?: return null
        return CategoryEntity(
            key = "$providerId:$kind:$id", providerId = providerId,
            remoteId = id, kind = kind, name = name,
            orderIndex = old?.orderIndex ?: order, hidden = old?.hidden ?: false
        )
    }

    fun item(providerId: String, kind: String, data: Map<*, *>,
             old: StreamEntity? = null): StreamEntity? {
        if (providerId.isBlank() || kind !in setOf("live", "movie", "series")) return null
        val id = XtreamIdentifier.normalize(data[if (kind == "series") "series_id" else "stream_id"])
            ?: return null
        val name = data.text("name") ?: return null
        val icon = if (kind == "series") {
            data.artwork("cover", "cover_big", "stream_icon", "movie_image", "thumbnail")
        } else {
            data.artwork("stream_icon", "movie_image", "cover_big", "cover", "thumbnail")
        } ?: old?.icon
        val added = (if (kind == "series") data.text("last_modified") else data.text("added"))
            ?.toLongOrNull() ?: old?.addedAt
        val backdrop = (data["backdrop_path"] as? List<*>)?.firstNotNullOfOrNull { entry ->
            entry?.toString()?.trim()?.takeIf {
                it.startsWith("https://", true) || it.startsWith("http://", true)
            }
        } ?: data.artwork("backdrop", "backdrop_url") ?: old?.backdrop
        val sourceCategory = XtreamIdentifier.normalize(data["category_id"])
            ?: old?.categoryId
        return StreamEntity(
            key = "$providerId:$kind:$id", providerId = providerId,
            remoteId = id, categoryId = sourceCategory, kind = kind,
            name = name, icon = icon,
            extension = data.text("container_extension") ?: old?.extension,
            directSource = null, epgChannelId = data.text("epg_channel_id") ?: old?.epgChannelId,
            streamType = data.text("stream_type") ?: old?.streamType,
            addedAt = added, plot = data.text("plot") ?: old?.plot,
            genre = data.text("genre") ?: old?.genre,
            releaseDate = data.text("releaseDate") ?: old?.releaseDate,
            year = data.text("year") ?: old?.year,
            rating = data.text("rating") ?: old?.rating,
            duration = data.text("episode_run_time") ?: old?.duration,
            backdrop = backdrop,
            archiveEnabled = data.text("tv_archive")?.let { it == "1" || it == "true" }
                ?: old?.archiveEnabled ?: false,
            archiveDurationDays = data.text("tv_archive_duration")?.toIntOrNull()
                ?: old?.archiveDurationDays ?: 0,
            favorite = old?.favorite ?: false, locked = old?.locked ?: false
        )
    }
}
