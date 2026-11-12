package tv.blofy.player.ui.search

import tv.blofy.player.core.text.ArabicSearchNormalizer

/**
 * The user's literal query, NOT the LLM's guess, controls hard constraints.
 * A model-inferred year must never silently hide filmography titles.
 */
internal object AiCatalogQueryPolicy {
    private val yearExpression = Regex("""(?<!\d)(?:19|20)\d{2}(?!\d)""")
    fun explicitYear(query: String): Int? =
        yearExpression.find(ArabicSearchNormalizer.normalize(query))
            ?.value?.toIntOrNull()?.takeIf { it in 1900..2035 }

    fun matchesYear(itemYear: String?, itemName: String, year: Int?): Boolean {
        if (year == null) return true
        return itemYear?.toIntOrNull() == year ||
            yearExpression.findAll(ArabicSearchNormalizer.normalize(itemName))
                .any { it.value.toIntOrNull() == year }
    }
}
