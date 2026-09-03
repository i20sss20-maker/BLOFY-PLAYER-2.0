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

        val watched = buildList {
            for (state in states) {
                dao.stream(state.contentKey)?.let { add(it) }
            }
        }
        val scores = watched.groupingBy { it.kind }.eachCount()
        val preferred = scores.maxByOrNull { it.value }?.key ?: "movie"

        val continueItems = buildList {
            val seen = hashSetOf<String>()
            for (state in states) {
                if (state.completed || state.positionMs <= 0L) continue
                val item = dao.stream(state.contentKey) ?: continue
                if ((item.kind == "movie" || item.kind == "series") && seen.add(item.key)) {
                    add(item)
                    if (size >= 12) break
                }
            }
        }

        val latest = dao.latestHomeStreams(providerId, 80)
        val favoriteGenres = watched.asSequence()
            .flatMap { it.genre.orEmpty().split(',', '/', '|').asSequence() }
            .map { it.trim().lowercase() }
            .filter { it.length >= 3 }
            .groupingBy { it }
            .eachCount()
            .entries.sortedByDescending { it.value }.take(4).map { it.key }

        val continueKeys = continueItems.mapTo(hashSetOf()) { it.key }
        val ranked = latest.asSequence()
            .filter { it.kind == "movie" || it.kind == "series" }
            .filterNot { it.key in continueKeys }
            .map { item ->
                var score = 0
                if (item.kind == preferred) score += 8
                val g = item.genre.orEmpty().lowercase()
                score += favoriteGenres.count { it in g } * 5
                item.rating?.toDoubleOrNull()?.let { score += it.toInt() }
                if ((item.addedAt ?: 0L) > 0L) score += 2
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
