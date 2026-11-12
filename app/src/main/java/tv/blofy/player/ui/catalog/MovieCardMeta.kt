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
        cachedDetailGenres: List<String> = emptyList(),
        arabic: Boolean = false
    ): String? {
        val providerText = item.genre.orEmpty().trim()
        val cachedText = cachedDetailGenres.filter(String::isNotBlank).joinToString(" / ").trim()
        val value = providerText.ifBlank { cachedText }
        val ids = MovieGenres.identify(value.ifBlank { null }).ifEmpty {
            if (value.isBlank()) MovieGenres.identify(null, categoryName) else emptySet()
        }
        if (ids.isNotEmpty()) {
            return MovieGenres.genres.asSequence()
                .filter { it.key in ids }.take(2)
                .map { if (arabic) it.arabic else it.english }.joinToString(" / ")
        }
        // Unrecognised provider-supplied genre should still be displayed as-is.
        return value.takeIf(String::isNotBlank)?.take(64)
    }

    fun subtitle(
        item: StreamEntity,
        badges: List<String>,
        categoryName: String?,
        cachedDetailGenres: List<String> = emptyList(),
        arabic: Boolean = false
    ): String {
        if (item.kind != "movie" && item.kind != "series") {
            return listOfNotNull(item.year?.takeIf(String::isNotBlank))
                .plus(badges).distinct().joinToString("  •  ")
        }
        // Series and movies use the same authoritative category/detail fallback.
        // Do not translate arbitrary provider strings or guess genres from titles.
        val first = genre(item, categoryName, cachedDetailGenres, arabic)
            ?: if (item.kind == "series") (if (arabic) "مسلسل" else "Series")
            else (if (arabic) "فيلم" else "Movie")
        val fields = if (item.kind == "series") {
            listOfNotNull(first, item.year?.takeIf(String::isNotBlank))
        } else listOf(first)
        return (fields + badges).filter(String::isNotBlank)
            .distinct().joinToString("  •  ")
    }
}
