package tv.blofy.player.ui.home

import tv.blofy.player.data.SeriesEpisodeParser
import tv.blofy.player.data.local.BlofyDao
import tv.blofy.player.data.local.StreamEntity
import tv.blofy.player.data.local.WatchStateEntity
import tv.blofy.player.ui.library.ContinueWatchingEntry
import tv.blofy.player.ui.library.ContinueWatchingResolver

/** Resolves saved history independently of the small latest-title selection used by Home. */
internal object HomeWatchHistory {
    data class Snapshot(
        val continueItems: List<StreamEntity>,
        val recentItems: List<StreamEntity>,
        val watchStates: Map<String, WatchStateEntity>,
    )

    suspend fun load(
        dao: BlofyDao,
        providerId: String,
        limit: Int = 16,
        minimumResumeMs: Long = 30_000L,
    ): Snapshot {
        require(limit > 0)
        val continuing = linkedMapOf<String, StreamEntity>()
        val recent = linkedMapOf<String, StreamEntity>()
        val resumeStates = linkedMapOf<String, WatchStateEntity>()
        val parents = mutableMapOf<String, StreamEntity?>()
        val states = dao.watchStates(providerId).asSequence()
            .filter { it.providerId == providerId && it.positionMs > 0L && it.kind != "live" }
            .sortedByDescending { it.updatedAt }
            .take(MAX_STATE_LOOKUPS)

        for (state in states) {
            var stream = if (state.kind == "episode") null else dao.stream(state.contentKey)
            val episode = if (stream == null) dao.episode(state.contentKey) else null
            if (stream == null && episode == null && state.kind == "episode") stream = dao.stream(state.contentKey)
            val parent = episode?.takeIf { it.providerId == providerId }?.let {
                if (!parents.containsKey(it.seriesId)) {
                    val normalized = SeriesEpisodeParser.normalizeSeriesIdForRequest(it.seriesId)
                    parents[it.seriesId] = listOf(it.seriesId, normalized, "$normalized.0").distinct()
                        .firstNotNullOfOrNull { id -> dao.stream("$providerId:series:$id") }
                }
                parents[it.seriesId]
            }
            val entry = ContinueWatchingResolver.resolve(
                listOf(state),
                stream?.let { mapOf(it.key to it) }.orEmpty(),
                episode?.let { mapOf(it.key to it) }.orEmpty(),
                listOfNotNull(parent),
            ).firstOrNull()
            val item = when (entry) {
                is ContinueWatchingEntry.StreamEntry -> entry.stream
                is ContinueWatchingEntry.EpisodeEntry -> entry.parentSeries
                null -> null
            }?.takeIf { it.providerId == providerId && it.kind in setOf("movie", "series") }
                ?: continue

            if (recent.size < limit) recent.putIfAbsent(item.key, item)
            if (!state.completed && state.positionMs > minimumResumeMs && continuing.size < limit &&
                !continuing.containsKey(item.key)) {
                continuing[item.key] = item
                // A series card shows the progress of its most recent unfinished episode.
                resumeStates[item.key] = state
            }
            if (recent.size >= limit && continuing.size >= limit) break
        }
        return Snapshot(continuing.values.toList(), recent.values.toList(), resumeStates)
    }

    private const val MAX_STATE_LOOKUPS = 240
}
