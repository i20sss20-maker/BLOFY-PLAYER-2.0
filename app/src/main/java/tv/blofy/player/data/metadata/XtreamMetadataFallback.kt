package tv.blofy.player.data.metadata

import okhttp3.HttpUrl.Companion.toHttpUrl
import tv.blofy.player.BlofyApp
import tv.blofy.player.data.local.ProviderEntity
import tv.blofy.player.data.local.StreamEntity
import tv.blofy.player.data.remote.XtreamClient

/**
 * Provider-only metadata. UI reads are local-only; network fetches are exposed only to the
 * background preload worker so opening a movie/series page never starts another provider request.
 */
object XtreamMetadataFallback {
    suspend fun movie(provider: ProviderEntity, stream: StreamEntity): ProviderMetadata.Metadata? =
        BlofyApp.contextOrNull()?.let { ProviderMetadataCache.read(it, stream.key) }

    suspend fun series(provider: ProviderEntity, stream: StreamEntity): ProviderMetadata.Metadata? =
        BlofyApp.contextOrNull()?.let { ProviderMetadataCache.read(it, stream.key) }

    internal suspend fun fetchMovie(provider: ProviderEntity, stream: StreamEntity): ProviderMetadata.Metadata? =
        load(provider, stream, "get_vod_info", "vod_id", "movie")

    internal suspend fun fetchSeries(provider: ProviderEntity, stream: StreamEntity): ProviderMetadata.Metadata? =
        load(provider, stream, "get_series_info", "series_id", "tv")

    private suspend fun load(
        provider: ProviderEntity,
        stream: StreamEntity,
        action: String,
        idKey: String,
        kind: String
    ): ProviderMetadata.Metadata? {
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
        return parseResponse(provider, stream, root, kind)
    }

    internal fun parseResponse(provider: ProviderEntity, stream: StreamEntity, root: Map<String, Any?>, kind: String): ProviderMetadata.Metadata? {
        val info = map(root["info"])
        val movieData = map(root["movie_data"])
        val source = LinkedHashMap<String, Any?>().apply { putAll(movieData); putAll(info) }
        if (source.isEmpty()) return null

        val title = text(source, "name", "title", "o_name").ifBlank { stream.name }
        val plot = text(source, "plot", "description").ifBlank { stream.plot.orEmpty() }.ifBlank { null }
        val genreText = text(source, "genre", "genres").ifBlank { stream.genre.orEmpty() }
        val genres = splitValues(genreText)
        val cast = castValues(provider, source).take(14)
        val crew = buildList {
            splitValues(text(source, "director")).take(3).forEach { add(ProviderMetadata.Credit(it, "المخرج")) }
            splitValues(text(source, "writer", "writers")).take(3).forEach { add(ProviderMetadata.Credit(it, "الكاتب")) }
        }.distinctBy { it.name to it.job }

        val rating = number(source["rating"] ?: source["rating_5based"] ?: stream.rating)
        val releaseDate = text(source, "releasedate", "release_date", "releaseDate", "first_air_date")
            .ifBlank { stream.releaseDate.orEmpty() }.ifBlank { null }
        val durationMinutes = durationMinutes(source, stream)
        val poster = resolveArtwork(provider, text(source, "movie_image", "cover", "cover_big", "stream_icon"))
            ?: stream.icon?.takeIf(String::isNotBlank)
        val backdrop = resolveArtwork(provider, firstBackdrop(source["backdrop_path"] ?: source["backdrop"]).orEmpty())
            ?: stream.backdrop?.takeIf(String::isNotBlank)
        val country = splitValues(text(source, "country", "production_countries"))
        val language = text(source, "language", "original_language").ifBlank { null }
        val status = text(source, "status").ifBlank { null }

        val hasUsefulData = cast.isNotEmpty() || crew.isNotEmpty() || !plot.isNullOrBlank() ||
            genres.isNotEmpty() || !poster.isNullOrBlank() || !backdrop.isNullOrBlank()
        if (!hasUsefulData) return null

        return ProviderMetadata.Metadata(
            kind = kind,
            title = title,
            overview = plot,
            rating = rating,
            releaseDate = releaseDate,
            runtimeMinutes = durationMinutes,
            genres = genres,
            posterUrl = poster,
            backdropUrl = backdrop,
            logoUrl = resolveArtwork(provider, text(source, "logo", "logo_url", "logo_path")),
            trailerUrl = text(source, "youtube_trailer", "trailer").ifBlank { null },
            cast = cast,
            crew = crew,
            countries = country,
            originalLanguage = language,
            status = status,
            networks = splitValues(text(source, "network", "networks")),
        )
    }

    private fun castValues(provider: ProviderEntity, source: Map<String, Any?>): List<ProviderMetadata.Person> {
        val raw = source.entries.firstOrNull {
            it.key.equals("actors", true) || it.key.equals("cast", true) || it.key.equals("actor", true)
        }?.value
        val structured = when (raw) {
            is List<*> -> raw.mapNotNull { item ->
                val row = item as? Map<*, *> ?: return@mapNotNull null
                fun field(vararg names: String): String? = row.entries.firstOrNull { entry ->
                    names.any { wanted -> entry.key?.toString()?.equals(wanted, true) == true }
                }?.value?.toString()?.trim()?.takeIf { it.isNotBlank() && !it.equals("null", true) }

                val name = field("name", "actor", "original_name", "person_name").orEmpty()
                if (name.isBlank()) return@mapNotNull null
                val character = field("character", "role", "known_for_department")
                val profile = resolveArtwork(
                    provider,
                    field(
                        "profile", "profile_url", "profile_path", "profilePath",
                        "image", "image_url", "imageUrl", "photo", "avatar",
                        "thumbnail", "thumb", "poster"
                    ).orEmpty()
                )
                ProviderMetadata.Person(-kotlin.math.abs(name.hashCode()).coerceAtLeast(1), name, character, profile)
            }
            else -> emptyList()
        }
        if (structured.isNotEmpty()) return structured.distinctBy { it.name.lowercase() }

        return splitValues(text(source, "actors", "cast", "actor")).mapIndexed { index, name ->
            ProviderMetadata.Person(
                id = -kotlin.math.abs((name + index).hashCode()).coerceAtLeast(1),
                name = name,
                character = null,
                profileUrl = null
            )
        }
    }

    /** Accept provider-relative artwork as well as absolute HTTP(S) URLs. */
    private fun resolveArtwork(provider: ProviderEntity, raw: String): String? {
        val value = raw.trim().takeIf { it.isNotBlank() && !it.equals("null", true) } ?: return null
        val absolute = runCatching { java.net.URI(value) }.getOrNull()
        if (absolute != null && (absolute.scheme.equals("http", true) || absolute.scheme.equals("https", true)) && !absolute.host.isNullOrBlank()) {
            return value
        }
        return runCatching {
            java.net.URI(provider.baseUrl.trim().trimEnd('/') + "/").resolve(value).toString()
        }.getOrNull()?.takeIf { resolved ->
            runCatching { java.net.URI(resolved) }.getOrNull()?.let { uri ->
                (uri.scheme.equals("http", true) || uri.scheme.equals("https", true)) && !uri.host.isNullOrBlank()
            } == true
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
