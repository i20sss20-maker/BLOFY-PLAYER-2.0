package tv.blofy.player.ui.catalog

import tv.blofy.player.data.local.StreamEntity

/**
 * Movie cards should match series cards: the classification sits *beneath*
 * the poster/title as muted one-line metadata. Never render a new top filter.
 *
 * Prefer actual provider genre, then previously cached provider detail genres,
 * then a category explicitly describing a genre. Never infer genre from title,
 * poster artwork or an unspecific "New Release" category.
 */
internal object MovieCardMeta {
    fun genre(
        item: StreamEntity,
        categoryName: String?,
        cachedDetailGenres: List<String> = emptyList()
    ): String? {
        val providerText = item.genre.orEmpty().trim()
        val cachedText = cachedDetailGenres.filter(String::isNotBlank).joinToString(" / ").trim()
        val value = providerText.ifBlank { cachedText }
        val ids = MovieGenres.identify(value.ifBlank { null }, categoryName)
        if (ids.isNotEmpty()) {
            return MovieGenres.genres.asSequence()
                .filter { it.key in ids }.take(2)
                .map { it.english }.joinToString(" / ")
        }
        // Unrecognised provider-supplied genre should still be displayed as-is.
        return value.takeIf(String::isNotBlank)?.take(64)
    }

    fun subtitle(
        item: StreamEntity,
        badges: List<String>,
        categoryName: String?,
        cachedDetailGenres: List<String> = emptyList()
    ): String {
        if (item.kind != "movie") {
            return listOfNotNull(
                item.year?.takeIf(String::isNotBlank),
                item.genre?.takeIf(String::isNotBlank)?.substringBefore(',')
            ).plus(badges).distinct().joinToString("  •  ")
        }
        // A neutral "Movie" only when the content provider has no genre yet,
        // so film cards never have an unexplained blank metadata line.
        val first = genre(item, categoryName, cachedDetailGenres) ?: "Movie"
        return (listOf(first) + badges)
            .filter(String::isNotBlank).distinct().joinToString("  •  ")
    }
}
