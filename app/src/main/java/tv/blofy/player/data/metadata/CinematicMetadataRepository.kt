package tv.blofy.player.data.metadata

import android.content.Context

/**
 * Shared metadata models used by BLOFY details UI.
 *
 * BLOFY deliberately uses provider/server metadata only. External cinematic enrichment is disabled:
 * no TMDb lookups, no external actor images, no recommendation calls and no cached TMDb fallback.
 * XtreamMetadataFallback is the authoritative source for these models.
 */
object CinematicMetadataRepository {
    data class Person(
        val id: Int,
        val name: String,
        val character: String?,
        val profileUrl: String?
    )

    data class Credit(val name: String, val job: String)

    data class Metadata(
        val tmdbId: Int = -1,
        val kind: String,
        val title: String,
        val overview: String?,
        val rating: Double?,
        val voteCount: Int = 0,
        val releaseDate: String?,
        val runtimeMinutes: Int?,
        val genres: List<String>,
        val posterUrl: String?,
        val backdropUrl: String?,
        val logoUrl: String?,
        val trailerUrl: String? = null,
        val cast: List<Person>,
        val crew: List<Credit>,
        val countries: List<String>? = emptyList(),
        val originalLanguage: String? = null,
        val status: String? = null,
        val networks: List<String>? = emptyList(),
        val confidence: Double = 1.0,
        val fetchedAt: Long = System.currentTimeMillis()
    )

    data class PersonWorks(
        val personName: String,
        val profileUrl: String?,
        val titles: List<String>
    )

    // Compatibility methods remain so older detail screens compile, but they never contact an
    // external metadata service. Provider/Xtream metadata is the only accepted source.
    @Suppress("UNUSED_PARAMETER")
    suspend fun movie(context: Context, title: String, year: String?): Metadata? = null

    @Suppress("UNUSED_PARAMETER")
    suspend fun series(context: Context, title: String, year: String?): Metadata? = null

    @Suppress("UNUSED_PARAMETER")
    suspend fun personWorks(query: String): PersonWorks? = null

    @Suppress("UNUSED_PARAMETER")
    suspend fun recommendations(metadata: Metadata): List<String> = emptyList()
}
