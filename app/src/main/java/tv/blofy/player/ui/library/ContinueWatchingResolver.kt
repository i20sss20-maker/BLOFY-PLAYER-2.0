package tv.blofy.player.ui.library

import tv.blofy.player.data.SeriesEpisodeParser
import tv.blofy.player.data.local.EpisodeEntity
import tv.blofy.player.data.local.StreamEntity
import tv.blofy.player.data.local.WatchStateEntity

internal sealed interface ContinueWatchingEntry {
    val state: WatchStateEntity

    data class StreamEntry(
        val stream: StreamEntity,
        override val state: WatchStateEntity
    ) : ContinueWatchingEntry

    data class EpisodeEntry(
        val episode: EpisodeEntity,
        val parentSeries: StreamEntity?,
        override val state: WatchStateEntity
    ) : ContinueWatchingEntry
}

/** Resolves watch-state keys against both catalog tables without changing their recency order. */
internal object ContinueWatchingResolver {
    fun resolve(
        states: List<WatchStateEntity>,
        streamsByKey: Map<String, StreamEntity>,
        episodesByKey: Map<String, EpisodeEntity>,
        series: List<StreamEntity>
    ): List<ContinueWatchingEntry> {
        val exactSeries = series.associateBy(StreamEntity::remoteId)
        val normalizedSeries = series.associateBy {
            SeriesEpisodeParser.normalizeSeriesIdForRequest(it.remoteId)
        }

        fun parentFor(episode: EpisodeEntity): StreamEntity? =
            exactSeries[episode.seriesId]
                ?: normalizedSeries[SeriesEpisodeParser.normalizeSeriesIdForRequest(episode.seriesId)]

        return states.mapNotNull { state ->
            val stream = streamsByKey[state.contentKey]
                ?.takeIf { it.providerId == state.providerId }
            val episode = episodesByKey[state.contentKey]
                ?.takeIf { it.providerId == state.providerId }

            // Current builds save episodes with kind=episode. The fallback by primary key keeps
            // older watch-state rows usable if they were saved with a different kind.
            if (state.kind == "episode") {
                episode?.let { ContinueWatchingEntry.EpisodeEntry(it, parentFor(it), state) }
                    ?: stream?.let { ContinueWatchingEntry.StreamEntry(it, state) }
            } else {
                stream?.let { ContinueWatchingEntry.StreamEntry(it, state) }
                    ?: episode?.let { ContinueWatchingEntry.EpisodeEntry(it, parentFor(it), state) }
            }
        }
    }
}
