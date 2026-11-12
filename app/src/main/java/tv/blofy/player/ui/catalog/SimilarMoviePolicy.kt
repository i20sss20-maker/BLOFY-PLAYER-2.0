package tv.blofy.player.ui.catalog

import tv.blofy.player.data.local.StreamEntity

/**
 * No "related" row is fabricated from title words or a generic category.
 * Recommendations must share actual provider genre tags or a category
 * explicitly named for that genre.
 */
internal object SimilarMoviePolicy {
    fun genreKeys(
        film: StreamEntity,
        metadataGenres: List<String>,
        categoryName: String?
    ): Set<String> = MovieGenres.identify(
        listOfNotNull(film.genre, metadataGenres.joinToString(", ")).joinToString(", "),
        categoryName
    )

    fun rank(
        film: StreamEntity,
        metadataGenres: List<String>,
        candidates: List<StreamEntity>,
        categoryNames: Map<String, String>,
        limit: Int = 10
    ): List<StreamEntity> {
        val source = genreKeys(film, metadataGenres, categoryNames[film.categoryId])
        if (source.isEmpty()) return emptyList()
        return candidates.asSequence()
            .filter { it.kind == "movie" && it.key != film.key && !it.locked }
            .map { entry ->
                val shared = source.intersect(
                    MovieGenres.identify(entry.genre, categoryNames[entry.categoryId]))
                entry to shared.size
            }
            .filter { it.second > 0 }
            .sortedWith(compareByDescending<Pair<StreamEntity, Int>> { it.second }
                .thenByDescending { it.first.rating?.toDoubleOrNull()?.takeIf { r -> r in 0.0..10.0 } ?: 0.0 }
                .thenByDescending { it.first.addedAt ?: 0L })
            .map { it.first }
            .distinctBy { it.key }
            .take(limit.coerceIn(1, 16))
            .toList()
    }
}
