package tv.blofy.player.ui.search

import tv.blofy.player.data.local.BlofyDao
import tv.blofy.player.data.local.StreamEntity
import tv.blofy.player.data.metadata.ProviderMetadataCache
import tv.blofy.player.ui.catalog.MovieGenres
import tv.blofy.player.core.text.ArabicSearchNormalizer

/**
 * Resolves model suggestions to the subscriber's OWN local catalog only.
 * This class never touches playback URLs, provider credentials or LLM keys.
 */
internal object AiChatCatalogResolver {
    data class Results(val titles: List<StreamEntity>, val alternatives: Boolean)

    suspend fun find(
        dao: BlofyDao,
        providerIds: List<String>,
        parsed: StreamAiSearchClient.Intent,
        question: String,
        applicationContext: android.content.Context
    ): Results {
        val genre = AiRecommendationRanker.requestedGenre(question, parsed.genre)
        val expectedYear = AiCatalogQueryPolicy.explicitYear(question)
        val wantsSeries = listOf("مسلسل", "مسلسلات", "series", "tv show", "shows").any {
            question.contains(it, true)
        }
        val wantsMovies = listOf("فيلم", "أفلام", "افلام", "movie", "film").any {
            question.contains(it, true)
        }
        val kinds = when {
            wantsSeries && !wantsMovies -> listOf("series")
            wantsMovies && !wantsSeries -> listOf("movie")
            else -> listOf("movie", "series")
        }
        val collected = ArrayList<StreamEntity>(48)
        for (sourceId in providerIds.take(4)) {
            val names = buildMap<Pair<String, String>, String> {
                for (kind in kinds) for (category in dao.categorySnapshot(sourceId, kind)) {
                    put(kind to category.remoteId, category.name)
                    if (category.remoteId.toLongOrNull() != null)
                        put(kind to "${category.remoteId}.0", category.name)
                }
            }
            val candidates = ArrayList<StreamEntity>()
            val queries = (parsed.suggestedTitles.take(12) +
                listOf(parsed.title).filter { it.length in 3..90 }).distinct()
            for (title in queries) {
                for (kind in kinds) {
                    // Only the actual indexed provider records may become a
                    // clickable recommendation. Model-proposed names are NOT proof.
                    val needle = ArabicSearchNormalizer.ftsQuery(
                        ArabicSearchNormalizer.normalize(title.take(95)))
                    if (needle.isBlank()) continue
                    val found = runCatching {
                        dao.searchStreamsFtsByKind(sourceId, kind, needle, 26)
                    }.getOrDefault(emptyList())
                    candidates.addAll(AiCatalogMatchPolicy.filterVerified(listOf(title), found, 5))
                }
            }
            if (genre != null) {
                if ("movie" in kinds) {
                    val canonical = if (genre == "science fiction") "scifi" else genre
                    candidates.addAll(runCatching {
                        dao.catalogPageForMovieGenre(
                            MovieGenres.catalogQuery(sourceId, null, canonical, limit = 128))
                    }.getOrDefault(emptyList()))
                }
                // For series, the real category may contain the genre even
                // when the StreamEntity.genre field is blank.
                if ("series" in kinds) candidates.addAll(
                    dao.catalogPageAfterAll(sourceId, "series", 0L, 128)
                        .filter { item ->
                            AiRecommendationRanker.matchesGenre(item.genre, genre,
                                item.categoryId?.let { names["series" to it] })
                        }
                )
            }
            if (parsed.person.isNotBlank() && CastSearchPolicy.searchable(parsed.person)) {
                val fromCredits = ProviderMetadataCache.searchPeopleCandidates(
                    applicationContext, sourceId,
                    CastSearchPolicy.candidateToken(parsed.person), 35
                )
                for ((key, meta) in fromCredits) {
                    if (!CastSearchPolicy.matches(meta, parsed.person)) continue
                    dao.stream(key)?.takeIf {
                        it.providerId == sourceId && it.kind in kinds && !it.locked
                    }?.let(candidates::add)
                }
            }
            // No unfiltered genre leakage: do not call ordinary title matches
            // "Action" if the source says they are Romance.
            collected.addAll(candidates.filter { item ->
                !item.locked && item.kind in kinds &&
                    AiRecommendationRanker.matchesGenre(item.genre, genre,
                        item.categoryId?.let { names[item.kind to it] }) &&
                    AiCatalogQueryPolicy.matchesYear(item.year, item.name, expectedYear)
            }.distinctBy { it.key }.take(40))
        }
        val verified = AiRecommendationRanker.rank(
            collected.distinctBy { it.key }, AiConversationPolicy.wantsRecent(question))
            .take(12)
        if (verified.isNotEmpty()) return Results(verified, false)

        val recommending = listOf("رشح", "اقترح", "اعطني", "عطني", "أبي", "ابي",
            "ابغى", "recommend", "suggest", "show me", "watch").any {
            question.contains(it, true)
        }
        if (!recommending || parsed.person.isNotBlank()) return Results(emptyList(), false)

        // If source metadata has no requested genre, offer real but explicitly
        // NON-MATCHING alternatives rather than silently hallucinating a match.
        val other = providerIds.take(4).flatMap { sourceId ->
            dao.latestHomeStreams(sourceId, 140)
                .filter { it.kind in kinds && !it.locked }
        }.distinctBy { it.key }
        return Results(AiRecommendationRanker.rank(other,
            AiConversationPolicy.wantsRecent(question)).take(8), true)
    }
}
