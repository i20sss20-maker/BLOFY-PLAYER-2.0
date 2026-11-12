package tv.blofy.player.ui.catalog

import tv.blofy.player.data.local.StreamEntity

/**
 * Select only visible movies whose source catalog cannot already tell us their
 * genre. Loading full metadata for all 24k+ films at once would overload Xtream.
 * Detail requests are handled separately with a small concurrency/batch cap.
 */
internal object MovieGenrePrefetchPolicy {
    fun candidates(
        visible: List<StreamEntity>,
        categoryNames: Map<String, String>,
        cachedGenres: Map<String, List<String>>,
        recentlyAttemptedKeys: Set<String>,
        limit: Int = 12
    ): List<StreamEntity> = visible.asSequence()
        .filter { it.kind == "movie" && it.remoteId.isNotBlank() }
        .filter { it.key !in recentlyAttemptedKeys }
        .filter { item ->
            MovieCardMeta.genre(item, categoryNames[item.categoryId], cachedGenres[item.key].orEmpty()) == null
        }
        .distinctBy { it.key }
        .take(limit.coerceIn(1, 12))
        .toList()
}
