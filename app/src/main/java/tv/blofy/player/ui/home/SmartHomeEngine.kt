package tv.blofy.player.ui.home

import tv.blofy.player.data.local.BlofyDao
import tv.blofy.player.data.local.StreamEntity

internal object SmartHomeEngine {
    data class Snapshot(
        val preferredKind: String,
        val continueItems: List<StreamEntity>,
        val recentItems: List<StreamEntity>,
        val recommended: List<StreamEntity>
    )

    suspend fun build(dao: BlofyDao, providerId: String): Snapshot {
        val states = dao.watchStates(providerId).sortedByDescending { it.updatedAt }
        val watched = states.mapNotNull { state -> dao.stream(state.contentKey) }
        val scores = watched.groupingBy { it.kind }.eachCount()
        val preferred = scores.maxByOrNull { it.value }?.key ?: "movie"

        val continueItems = states.asSequence()
            .filter { !it.completed && it.positionMs > 0L }
            .mapNotNull { dao.stream(it.contentKey) }
            .filter { it.kind == "movie" || it.kind == "series" }
            .distinctBy { it.key }
            .take(12)
            .toList()

        val latest = dao.latestHomeStreams(providerId, 80)
        val favoriteGenres = watched.asSequence()
            .flatMap { it.genre.orEmpty().split(',', '/', '|').asSequence() }
            .map { it.trim().lowercase() }
            .filter { it.length >= 3 }
            .groupingBy { it }
            .eachCount()
            .entries.sortedByDescending { it.value }.take(4).map { it.key }

        val ranked = latest.asSequence()
            .filter { it.kind == "movie" || it.kind == "series" }
            .filterNot { item -> continueItems.any { it.key == item.key } }
            .map { item ->
                var score = 0
                if (item.kind == preferred) score += 8
                val g = item.genre.orEmpty().lowercase()
                score += favoriteGenres.count { it in g } * 5
                item.rating?.toDoubleOrNull()?.let { score += it.toInt() }
                score += if ((item.addedAt ?: 0L) > 0L) 2 else 0
                item to score
            }
            .sortedByDescending { it.second }
            .map { it.first }
            .distinctBy { it.key }
            .take(24)
            .toList()

        val recent = watched.distinctBy { it.key }.take(12)
        return Snapshot(preferred, continueItems, recent, ranked)
    }
}
