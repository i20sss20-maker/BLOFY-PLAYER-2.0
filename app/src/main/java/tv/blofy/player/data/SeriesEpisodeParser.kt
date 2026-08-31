package tv.blofy.player.data

import com.google.gson.Gson
import com.google.gson.JsonElement
import tv.blofy.player.data.local.EpisodeEntity
import tv.blofy.player.data.remote.XtreamIdentifier
import java.math.BigDecimal

data class ParsedSeriesEpisodes(
    val episodes: List<EpisodeEntity>,
    val payloadPresent: Boolean
)

data class SeriesEpisodeSyncResult(
    val episodeCount: Int,
    val payloadPresent: Boolean,
    val cacheUpdated: Boolean
)

/**
 * Parses the loose response shapes used by Xtream-compatible servers.
 *
 * The documented shape is a map keyed by season, but real providers also return a flat list,
 * an indexed map, wrapper objects, numeric values decoded as Double, and occasionally a
 * JSON-encoded `episodes` string. Keeping this parser independent from Retrofit makes those
 * variants deterministic and unit-testable.
 */
object SeriesEpisodeParser {
    private val gson = Gson()
    private val episodeIdKeys = listOf("id", "episode_id", "stream_id")
    private val episodeNumberKeys = listOf("episode_num", "episode", "episode_number", "number")
    private val seasonNumberKeys = listOf("season", "season_num", "season_number")

    fun parse(
        providerId: String,
        seriesId: String,
        response: Any?
    ): ParsedSeriesEpisodes {
        val decodedResponse = decodeJsonContainer(response)
        val namedPayload = findNamedEpisodesPayload(decodedResponse)
        val payload = namedPayload ?: decodedResponse.takeIf {
            containsEpisodeRows(it) || isTopLevelListPayload(it)
        }
        if (payload == null) return ParsedSeriesEpisodes(emptyList(), payloadPresent = false)

        val candidates = mutableListOf<Candidate>()
        collectCandidates(decodeJsonContainer(payload), inheritedSeason = null, keyHint = null, ordinalHint = null, candidates)

        val episodes = candidates.mapNotNull { candidate ->
            val row = candidate.row
            val remoteId = episodeIdKeys.firstNotNullOfOrNull { key -> normalizedId(row.value(key)) }
                ?: normalizedId(candidate.keyHint)
                ?: return@mapNotNull null
            val season = seasonNumberKeys.firstNotNullOfOrNull { key -> flexibleInt(row.value(key)) }
                ?: candidate.inheritedSeason
                ?: 1
            val episode = episodeNumberKeys.firstNotNullOfOrNull { key -> flexibleInt(row.value(key)) }
                ?: candidate.ordinalHint
                ?: 1
            val title = row.stringValue("title")
                ?: row.stringValue("name")
                ?: "Episode $episode"
            val extension = (row.stringValue("container_extension") ?: row.stringValue("extension") ?: "mp4")
                .trim()
                .trimStart('.')
                .ifBlank { "mp4" }
            val info = row.value("info") as? Map<*, *>
            val duration = row.durationValue() ?: info?.durationValue()

            EpisodeEntity(
                key = "$providerId:episode:$remoteId",
                providerId = providerId,
                seriesId = seriesId,
                remoteId = remoteId,
                season = season,
                episode = episode,
                title = title,
                extension = extension,
                directSource = row.stringValue("direct_source") ?: info?.stringValue("direct_source"),
                durationSecs = duration
            )
        }
            .distinctBy { it.key }
            .sortedWith(compareBy<EpisodeEntity> { it.season }.thenBy { it.episode }.thenBy { it.title })

        return ParsedSeriesEpisodes(episodes, payloadPresent = true)
    }

    /** Normalizes IDs accidentally persisted as Gson decimal strings, e.g. `8742.0`. */
    fun normalizeSeriesIdForRequest(seriesId: String): String {
        val trimmed = seriesId.trim()
        return if (trimmed.matches(Regex("[+-]?\\d+\\.0+"))) trimmed.substringBefore('.') else trimmed
    }

    private fun findNamedEpisodesPayload(node: Any?, depth: Int = 0): Any? {
        if (depth > 6) return null
        return when (val decoded = decodeJsonContainer(node)) {
            is Map<*, *> -> {
                decoded.entries.firstOrNull { it.key?.toString()?.equals("episodes", ignoreCase = true) == true }
                    ?.value
                    ?: decoded.values.firstNotNullOfOrNull { findNamedEpisodesPayload(it, depth + 1) }
            }
            is Iterable<*> -> decoded.firstNotNullOfOrNull { findNamedEpisodesPayload(it, depth + 1) }
            is Array<*> -> decoded.firstNotNullOfOrNull { findNamedEpisodesPayload(it, depth + 1) }
            else -> null
        }
    }

    private fun containsEpisodeRows(node: Any?, depth: Int = 0): Boolean {
        if (depth > 6) return false
        return when (val decoded = decodeJsonContainer(node)) {
            is Map<*, *> -> isEpisodeRow(decoded) || decoded.values.any { containsEpisodeRows(it, depth + 1) }
            is Iterable<*> -> decoded.any { containsEpisodeRows(it, depth + 1) }
            is Array<*> -> decoded.any { containsEpisodeRows(it, depth + 1) }
            else -> false
        }
    }

    /**
     * A top-level list is itself a recognized Xtream episode payload. In particular, `[]`
     * means the provider returned a valid but currently empty result, rather than no payload.
     */
    private fun isTopLevelListPayload(node: Any?): Boolean = when (decodeJsonContainer(node)) {
        is Iterable<*>, is Array<*> -> true
        else -> false
    }

    private fun collectCandidates(
        node: Any?,
        inheritedSeason: Int?,
        keyHint: String?,
        ordinalHint: Int?,
        output: MutableList<Candidate>,
        depth: Int = 0
    ) {
        if (depth > 10) return
        when (val decoded = decodeJsonContainer(node)) {
            is Map<*, *> -> {
                if (isEpisodeRow(decoded, keyHint)) {
                    output += Candidate(decoded, inheritedSeason, keyHint, ordinalHint)
                    return
                }
                decoded.entries.forEachIndexed { index, (rawKey, value) ->
                    val key = rawKey?.toString()
                    val decodedValue = decodeJsonContainer(value)
                    val valueIsRow = decodedValue is Map<*, *> && isEpisodeRow(decodedValue, key)
                    val numericKey = flexibleInt(key)
                    val nextSeason = when {
                        inheritedSeason != null -> inheritedSeason
                        numericKey != null && !valueIsRow -> numericKey
                        else -> null
                    }
                    collectCandidates(
                        node = decodedValue,
                        inheritedSeason = nextSeason,
                        keyHint = key.takeIf { valueIsRow },
                        ordinalHint = index + 1,
                        output = output,
                        depth = depth + 1
                    )
                }
            }
            is Iterable<*> -> decoded.forEachIndexed { index, value ->
                collectCandidates(value, inheritedSeason, null, index + 1, output, depth + 1)
            }
            is Array<*> -> decoded.forEachIndexed { index, value ->
                collectCandidates(value, inheritedSeason, null, index + 1, output, depth + 1)
            }
        }
    }

    private fun isEpisodeRow(row: Map<*, *>, keyHint: String? = null): Boolean {
        val hasId = episodeIdKeys.any { row.value(it) != null }
        val hasEpisodeNumber = episodeNumberKeys.any { row.value(it) != null }
        val hasKeyedId = normalizedId(keyHint) != null
        val hasEpisodeMetadata = hasEpisodeNumber ||
            seasonNumberKeys.any { row.value(it) != null } ||
            row.value("title") != null ||
            row.value("container_extension") != null
        // Some providers key each episode by its stream ID and omit both `id` and
        // `episode_num` inside the row. The parent key is the remote ID in that shape.
        return hasEpisodeMetadata && (hasId || hasEpisodeNumber || hasKeyedId)
    }

    private fun decodeJsonContainer(value: Any?): Any? {
        if (value is JsonElement) {
            return runCatching { gson.fromJson(value, Any::class.java) }.getOrNull()
        }
        if (value !is String) return value
        val trimmed = value.trim()
        if (!(trimmed.startsWith('{') && trimmed.endsWith('}')) &&
            !(trimmed.startsWith('[') && trimmed.endsWith(']'))
        ) return value
        return runCatching { gson.fromJson(trimmed, Any::class.java) }.getOrDefault(value)
    }

    private fun normalizedId(value: Any?): String? {
        val normalized = XtreamIdentifier.normalize(value) ?: return null
        return if (normalized.matches(Regex("[+-]?\\d+\\.0+"))) normalized.substringBefore('.') else normalized
    }

    private fun flexibleInt(value: Any?): Int? {
        if (value == null) return null
        if (value is Number) {
            val number = value.toDouble()
            return if (number.isFinite()) number.toInt() else null
        }
        val text = value.toString().trim()
        return runCatching { BigDecimal(text).toInt() }.getOrNull()
            ?: Regex("(?i)(?:season|s)?\\s*(\\d+)").matchEntire(text)?.groupValues?.get(1)?.toIntOrNull()
    }

    private fun Map<*, *>.value(key: String): Any? = entries
        .firstOrNull { it.key?.toString()?.equals(key, ignoreCase = true) == true }
        ?.value

    private fun Map<*, *>.stringValue(key: String): String? = value(key)
        ?.toString()
        ?.trim()
        ?.takeIf { it.isNotBlank() && !it.equals("null", ignoreCase = true) }

    private fun Map<*, *>.durationValue(): Long? {
        val raw = value("duration_secs") ?: value("duration_seconds") ?: value("duration") ?: return null
        if (raw is Number) return raw.toLong().takeIf { it >= 0 }
        val text = raw.toString().trim()
        text.toDoubleOrNull()?.let { return it.toLong().takeIf { value -> value >= 0 } }
        val parts = text.split(':').mapNotNull(String::toLongOrNull)
        if (parts.size != text.count { it == ':' } + 1) return null
        return when (parts.size) {
            3 -> parts[0] * 3600 + parts[1] * 60 + parts[2]
            2 -> parts[0] * 60 + parts[1]
            else -> null
        }
    }

    private data class Candidate(
        val row: Map<*, *>,
        val inheritedSeason: Int?,
        val keyHint: String?,
        val ordinalHint: Int?
    )
}
