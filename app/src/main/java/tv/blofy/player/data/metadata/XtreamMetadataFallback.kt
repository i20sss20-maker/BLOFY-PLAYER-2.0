package tv.blofy.player.data.metadata

import okhttp3.HttpUrl.Companion.toHttpUrl
import tv.blofy.player.data.local.ProviderEntity
import tv.blofy.player.data.local.StreamEntity
import tv.blofy.player.data.remote.XtreamClient

/** Provider metadata fallback. It never participates in playback or exposes credentials. */
object XtreamMetadataFallback {
    suspend fun movie(provider: ProviderEntity, stream: StreamEntity): CinematicMetadataRepository.Metadata? =
        load(provider, stream, "get_vod_info", "vod_id", "movie")

    suspend fun series(provider: ProviderEntity, stream: StreamEntity): CinematicMetadataRepository.Metadata? =
        load(provider, stream, "get_series_info", "series_id", "tv")

    private suspend fun load(
        provider: ProviderEntity,
        stream: StreamEntity,
        action: String,
        idKey: String,
        kind: String
    ): CinematicMetadataRepository.Metadata? {
        if (!provider.providerType.equals("xtream", true) || stream.remoteId.isBlank()) return null
        val url = runCatching {
            (provider.baseUrl.trim().trimEnd('/') + "/player_api.php").toHttpUrl().newBuilder()
                .addQueryParameter("username", provider.username)
                .addQueryParameter("password", provider.password)
                .addQueryParameter("action", action)
                .addQueryParameter(idKey, stream.remoteId)
                .build().toString()
        }.getOrNull() ?: return null

        val root = runCatching { XtreamClient.api.objectResponse(url) }.getOrNull() ?: return null
        val info = map(root["info"])
        val movieData = map(root["movie_data"])
        val source = LinkedHashMap<String, Any?>().apply { putAll(movieData); putAll(info) }
        if (source.isEmpty()) return null

        val title = text(source, "name", "title", "o_name").ifBlank { stream.name }
        val plot = text(source, "plot", "description").ifBlank { stream.plot.orEmpty() }.ifBlank { null }
        val genreText = text(source, "genre", "genres").ifBlank { stream.genre.orEmpty() }
        val genres = splitValues(genreText)
        val cast = castValues(source).take(14)
        val crew = buildList {
            splitValues(text(source, "director")).take(3).forEach { add(CinematicMetadataRepository.Credit(it, "المخرج")) }
            splitValues(text(source, "writer", "writers")).take(3).forEach { add(CinematicMetadataRepository.Credit(it, "الكاتب")) }
        }.distinctBy { it.name to it.job }

        val rating = number(source["rating"] ?: source["rating_5based"] ?: stream.rating)
        val releaseDate = text(source, "releasedate", "release_date", "releaseDate", "first_air_date")
            .ifBlank { stream.releaseDate.orEmpty() }.ifBlank { null }
        val durationMinutes = durationMinutes(source, stream)
        val poster = text(source, "movie_image", "cover", "cover_big", "stream_icon")
            .ifBlank { stream.icon.orEmpty() }.ifBlank { null }
        val backdrop = firstBackdrop(source["backdrop_path"] ?: source["backdrop"])
            ?: stream.backdrop?.takeIf(String::isNotBlank)
        val country = splitValues(text(source, "country", "production_countries"))
        val language = text(source, "language", "original_language").ifBlank { null }
        val status = text(source, "status").ifBlank { null }

        val hasUsefulData = cast.isNotEmpty() || crew.isNotEmpty() || !plot.isNullOrBlank() ||
            genres.isNotEmpty() || !poster.isNullOrBlank() || !backdrop.isNullOrBlank()
        if (!hasUsefulData) return null

        return CinematicMetadataRepository.Metadata(
            tmdbId = -1,
            kind = kind,
            title = title,
            overview = plot,
            rating = rating,
            voteCount = 0,
            releaseDate = releaseDate,
            runtimeMinutes = durationMinutes,
            genres = genres,
            posterUrl = poster,
            backdropUrl = backdrop,
            logoUrl = null,
            trailerUrl = text(source, "youtube_trailer", "trailer").ifBlank { null },
            cast = cast,
            crew = crew,
            countries = country,
            originalLanguage = language,
            status = status,
            networks = splitValues(text(source, "network", "networks")),
            confidence = 1.0
        )
    }

    private fun castValues(source: Map<String, Any?>): List<CinematicMetadataRepository.Person> {
        val raw = source.entries.firstOrNull { it.key.equals("actors", true) || it.key.equals("cast", true) || it.key.equals("actor", true) }?.value
        val structured = when (raw) {
            is List<*> -> raw.mapNotNull { item ->
                val row = item as? Map<*, *> ?: return@mapNotNull null
                val name = row.entries.firstOrNull { it.key?.toString()?.equals("name", true) == true || it.key?.toString()?.equals("actor", true) == true }
                    ?.value?.toString()?.trim().orEmpty()
                if (name.isBlank()) return@mapNotNull null
                val character = row.entries.firstOrNull { it.key?.toString()?.equals("character", true) == true || it.key?.toString()?.equals("role", true) == true }
                    ?.value?.toString()?.trim()?.takeIf(String::isNotBlank)
                val profile = row.entries.firstOrNull {
                    val key = it.key?.toString().orEmpty()
                    key.equals("profile", true) || key.equals("profile_url", true) || key.equals("image", true) || key.equals("photo", true)
                }?.value?.toString()?.trim()?.takeIf { it.startsWith("http://") || it.startsWith("https://") }
                CinematicMetadataRepository.Person(-kotlin.math.abs(name.hashCode()).coerceAtLeast(1), name, character, profile)
            }
            else -> emptyList()
        }
        if (structured.isNotEmpty()) return structured.distinctBy { it.name.lowercase() }

        return splitValues(text(source, "actors", "cast", "actor")).mapIndexed { index, name ->
            CinematicMetadataRepository.Person(
                id = -kotlin.math.abs((name + index).hashCode()).coerceAtLeast(1),
                name = name,
                character = null,
                profileUrl = null
            )
        }
    }

    @Suppress("UNCHECKED_CAST")
    private fun map(value: Any?): Map<String, Any?> = when (value) {
        is Map<*, *> -> value.entries.associate { it.key.toString() to it.value }
        else -> emptyMap()
    }

    private fun text(source: Map<String, Any?>, vararg keys: String): String {
        for (key in keys) {
            val value = source.entries.firstOrNull { it.key.equals(key, true) }?.value ?: continue
            val result = when (value) {
                is String -> value
                is Number, is Boolean -> value.toString()
                is List<*> -> value.filterNotNull().joinToString(", ") { item ->
                    if (item is Map<*, *>) {
                        item.entries.firstOrNull { it.key?.toString()?.equals("name", true) == true }?.value?.toString().orEmpty()
                    } else item.toString()
                }
                else -> ""
            }.trim()
            if (result.isNotBlank() && result != "null") return result
        }
        return ""
    }

    private fun splitValues(value: String): List<String> = value
        .replace("[", "")
        .replace("]", "")
        .replace("\"", "")
        .replace("'", "")
        .replace("|", ",")
        .replace(";", ",")
        .replace(" • ", ",")
        .replace(" / ", ",")
        .replace(Regex("\\s{2,}"), " ")
        .split(',')
        .map { it.trim() }
        .filter { it.length >= 2 && !it.equals("null", true) }
        .distinctBy { it.lowercase() }

    private fun number(value: Any?): Double? = when (value) {
        is Number -> value.toDouble().takeIf { it > 0.0 }
        is String -> value.trim().toDoubleOrNull()?.takeIf { it > 0.0 }
        else -> null
    }

    private fun durationMinutes(source: Map<String, Any?>, stream: StreamEntity): Int? {
        val seconds = number(source["duration_secs"] ?: source["duration_seconds"])?.toLong()
        if (seconds != null && seconds > 0) return ((seconds + 59) / 60).toInt()
        val value = text(source, "duration").ifBlank { stream.duration.orEmpty() }
        value.toIntOrNull()?.takeIf { it in 1..1000 }?.let { return it }
        val parts = value.split(':').mapNotNull { it.toIntOrNull() }
        return when (parts.size) {
            3 -> parts[0] * 60 + parts[1] + if (parts[2] >= 30) 1 else 0
            2 -> parts[0] + if (parts[1] >= 30) 1 else 0
            else -> null
        }
    }

    private fun firstBackdrop(value: Any?): String? = when (value) {
        is String -> value.trim().takeIf(String::isNotBlank)
        is List<*> -> value.asSequence().mapNotNull { it?.toString()?.trim() }.firstOrNull(String::isNotBlank)
        else -> null
    }
}
