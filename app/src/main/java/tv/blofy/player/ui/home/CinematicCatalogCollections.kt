package tv.blofy.player.ui.home

import tv.blofy.player.data.local.StreamEntity

/**
 * Optional TryBox-style rails built solely from the selected provider's real library.
 * No external feeds, fabricated universes, imaginary ratings or unlocked content.
 * Operates on the same bounded catalog snapshot already used by the production home.
 */
internal object CinematicCatalogCollections {
    data class Collection(val title: String, val entries: List<StreamEntity>)

    private val universes = listOf(
        "عالم Spider-Man" to Regex("""spider[\s-]?man|سبايدر[\s-]?مان""", RegexOption.IGNORE_CASE),
        "عالم Batman" to Regex("""batman|باتمان|الرجل الخفاش""", RegexOption.IGNORE_CASE),
        "سلسلة Avengers" to Regex("""avengers|افنجرز|المنتقمون""", RegexOption.IGNORE_CASE),
        "عالم Harry Potter" to Regex("""harry[\s-]?potter|هاري[\s-]?بوتر""", RegexOption.IGNORE_CASE),
        "سلسلة John Wick" to Regex("""john[\s-]?wick|جون[\s-]?ويك""", RegexOption.IGNORE_CASE),
        "عالم Star Wars" to Regex("""star[\s-]?wars|حرب[\s-]?النجوم""", RegexOption.IGNORE_CASE)
    )

    private val genres = listOf(
        "أفلام الأكشن" to Regex("""action|أكشن|اكشن""", RegexOption.IGNORE_CASE),
        "عالم الخيال العلمي" to Regex("""sci[\s-]?fi|science fiction|خيال علمي""", RegexOption.IGNORE_CASE),
        "أجواء الرعب" to Regex("""horror|رعب""", RegexOption.IGNORE_CASE),
        "أفلام الكوميديا" to Regex("""comedy|كوميديا""", RegexOption.IGNORE_CASE)
    )

    fun from(items: List<StreamEntity>, maxCollections: Int = 4): List<Collection> {
        if (maxCollections <= 0) return emptyList()
        val safe = items.asSequence()
            .filter { !it.locked && it.name.isNotBlank() && it.kind in setOf("movie", "series") }
            .distinctBy { it.key }
            .toList()

        val franchise = universes.mapNotNull { (label, pattern) ->
            safe.filter { pattern.containsMatchIn(it.name) }
                .takeIf { it.size >= 2 }?.let { Collection(label, it.take(14)) }
        }
        val genreRails = genres.mapNotNull { (label, pattern) ->
            safe.filter { it.kind == "movie" && pattern.containsMatchIn(it.genre.orEmpty()) }
                .takeIf { it.size >= 4 }?.let { Collection(label, it.take(14)) }
        }
        return (franchise + genreRails).take(maxCollections)
    }
}
