package tv.blofy.player.ui.search

/**
 * On-device fallback for temporary gateway outages. No model hallucination:
 * only the local, indexed catalog may produce selectable titles.
 * Invalid/expired sessions are never routed through this fallback.
 */
internal object AiOfflineIntentPolicy {
    fun parse(question: String): StreamAiSearchClient.Intent {
        val clean = question.trim().take(160)
        val genre = AiRecommendationRanker.requestedGenre(clean, "").orEmpty()
        val wantsRecommendations = AiChatRoutingPolicy.maySuggestAlternatives(clean, "")
        val title = if (genre.isNotBlank() || wantsRecommendations) "" else clean
            .replace(Regex("""(?i)^(?:ابحث(?:\s+لي)?(?:\s+عن)?|دور\s+على|search\s+for|find\s+me)\s*"""), "")
            .replace(Regex("""(?i)^(?:فيلم|مسلسل|movie|film|series)\s+"""), "")
            .trim().take(95)
        return StreamAiSearchClient.Intent(
            kind = if (AiChatRoutingPolicy.kinds(clean) == listOf("series")) "series"
                else if (AiChatRoutingPolicy.kinds(clean) == listOf("movie")) "movie" else "mixed",
            person = "", genre = genre, title = title, year = null,
            suggestedTitles = emptyList(), reply = ""
        )
    }
}
