package tv.blofy.player.ui.search

import tv.blofy.player.data.local.StreamEntity

/**
 * Deterministic ranking of ACTUAL local provider records.
 * An LLM response never creates a playable catalog row.
 */
internal object AiRecommendationRanker {
    private val genreNames = mapOf(
        "action" to listOf("action", "أكشن", "اكشن"),
        "comedy" to listOf("comedy", "كوميديا", "كوميدي"),
        "crime" to listOf("crime", "جريمة", "جرائم", "تحقيق"),
        "horror" to listOf("horror", "رعب"),
        "thriller" to listOf("thriller", "إثارة", "اثارة", "تشويق"),
        "romance" to listOf("romance", "romantic", "رومانسي", "رومانسية"),
        "drama" to listOf("drama", "دراما"),
        "science fiction" to listOf("sci-fi", "science fiction", "خيال علمي"),
        "animation" to listOf("animation", "animated", "انميشن", "أنيميشن", "رسوم متحركة")
    )
    fun requestedGenre(query: String, modelGenre: String): String? {
        val normalized = (modelGenre + " " + query).lowercase()
        return genreNames.entries.firstOrNull { (_, aliases) ->
            aliases.any { normalized.contains(it, ignoreCase = true) }
        }?.key
    }
    fun matchesGenre(genre: String?, requested: String?): Boolean {
        if (requested.isNullOrBlank()) return true
        val value = genre.orEmpty()
        return genreNames[requested]?.any { value.contains(it, ignoreCase = true) }
            ?: value.contains(requested, ignoreCase = true)
    }
    fun rating(value: String?): Double =
        Regex("""\d+(?:[.,]\d+)?""").find(value.orEmpty())?.value
            ?.replace(',', '.')?.toDoubleOrNull()?.takeIf { it in 0.0..10.0 } ?: 0.0

    fun rank(items: List<StreamEntity>, newFirst: Boolean): List<StreamEntity> =
        if (newFirst) items.sortedWith(
            compareByDescending<StreamEntity> { it.year?.toIntOrNull() ?: 0 }
                .thenByDescending { rating(it.rating) }
        ) else items.sortedWith(
            compareByDescending<StreamEntity> { rating(it.rating) }
                .thenByDescending { it.year?.toIntOrNull() ?: 0 }
        )
}
