package tv.blofy.player.ui.home

import tv.blofy.player.data.local.BlofyDao
import tv.blofy.player.data.local.StreamEntity
import tv.blofy.player.ui.catalog.MovieGenres

/**
 * Local, explainable recommendations. No AI service, stream URLs or subscriber
 * details are sent anywhere; only a bounded catalog snapshot is ranked.
 */
internal object SmartHomeEngine {
    data class Snapshot(
        val preferredKind: String,
        val continueItems: List<StreamEntity>,
        val recentItems: List<StreamEntity>,
        val recommended: List<StreamEntity>
    )

    suspend fun build(dao: BlofyDao, providerId: String): Snapshot {
        val history = HomeWatchHistory.load(dao, providerId, limit = 24, minimumResumeMs = 0L)
        val candidates = dao.latestHomeStreams(providerId, 240)
        val watched = history.recentItems
        val preferred = preferredKind(watched)
        return Snapshot(
            preferredKind = preferred,
            continueItems = history.continueItems.take(12),
            recentItems = watched.take(12),
            recommended = recommend(watched, candidates, history.continueItems)
        )
    }

    fun preferredKind(watched: List<StreamEntity>): String =
        watched.asSequence().filter { it.kind == "movie" || it.kind == "series" }
            .groupingBy { it.kind }.eachCount().maxByOrNull { it.value }?.key ?: "movie"

    fun recommend(
        watched: List<StreamEntity>,
        candidates: List<StreamEntity>,
        continuing: List<StreamEntity> = emptyList(),
        limit: Int = 18
    ): List<StreamEntity> {
        val preferred = preferredKind(watched)
        val watchKeys = watched.mapTo(HashSet()) { it.key }
        val inProgress = continuing.mapTo(HashSet()) { it.key }
        val genreWeights = watched.asSequence()
            .flatMap { MovieGenres.identify(it.genre).asSequence() }
            .groupingBy { it }.eachCount()

        return candidates.asSequence()
            .filter { it.kind == "movie" || it.kind == "series" }
            .filterNot { it.key in watchKeys || it.key in inProgress || it.locked }
            .map { item ->
                // Distinct genres are provider-supplied: never infer from title.
                val matching = MovieGenres.identify(item.genre).sumOf { genreWeights[it] ?: 0 }
                val rating = item.rating?.toDoubleOrNull()
                    ?.takeIf { it.isFinite() && it in 0.0..10.0 } ?: 0.0
                val score = matching * 12 + if (item.kind == preferred) 4 else 0
                item to (score + rating)
            }
            .sortedWith(compareByDescending<Pair<StreamEntity, Double>> { it.second }
                .thenByDescending { it.first.addedAt ?: 0L }
                .thenBy { it.first.key })
            .map { it.first }
            .distinctBy { it.key }
            .take(limit.coerceIn(1, 24))
            .toList()
    }

    /** Label a real movie genre (or provider category) without title guessing. */
    fun byGenre(
        candidates: List<StreamEntity>,
        categoryNames: Map<String, String>,
        genreKey: String,
        limit: Int = 16
    ): List<StreamEntity> = candidates.asSequence()
        .filter { it.kind == "movie" && !it.locked }
        .filter { genreKey in MovieGenres.identify(it.genre, categoryNames[it.categoryId]) }
        .distinctBy { it.key }
        .take(limit.coerceIn(1, 24))
        .toList()
}
