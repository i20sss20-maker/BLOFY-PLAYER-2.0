package tv.blofy.player.data.metadata

/** Metadata models populated only from the active provider/server. */
object ProviderMetadata {
    data class Person(val id: Int, val name: String, val character: String?, val profileUrl: String?)
    data class Credit(val name: String, val job: String)
    data class Metadata(
        val kind: String, val title: String, val overview: String?, val rating: Double?, val releaseDate: String?,
        val runtimeMinutes: Int?, val genres: List<String>, val posterUrl: String?, val backdropUrl: String?,
        val logoUrl: String?, val trailerUrl: String? = null, val cast: List<Person>, val crew: List<Credit>,
        val countries: List<String> = emptyList(), val originalLanguage: String? = null, val status: String? = null,
        val networks: List<String> = emptyList()
    )
}
