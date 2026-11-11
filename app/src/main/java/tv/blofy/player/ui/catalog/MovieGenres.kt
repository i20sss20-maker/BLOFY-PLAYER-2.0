package tv.blofy.player.ui.catalog

import java.util.Locale
import androidx.sqlite.db.SimpleSQLiteQuery

/**
 * Display-only film genre classification. Uses the provider's actual genre and
 * its own category name, never guesses a movie's genre from its title.
 * The remote category ID, catalog key, and playback URL are never changed.
 */
internal object MovieGenres {
    data class Genre(val key: String, val arabic: String, val english: String, val aliases: List<String>)

    val genres = listOf(
        Genre("action", "أكشن", "Action", listOf("action", "اكشن", "أكشن", "حركه", "حركة")),
        Genre("comedy", "كوميديا", "Comedy", listOf("comedy", "كوميدي", "كوميديا")),
        Genre("drama", "دراما", "Drama", listOf("drama", "دراما")),
        Genre("adventure", "مغامرات", "Adventure", listOf("adventure", "مغامرة", "مغامرات")),
        Genre("thriller", "إثارة وتشويق", "Thriller", listOf("thriller", "suspense", "اثارة", "إثارة", "تشويق")),
        Genre("horror", "رعب", "Horror", listOf("horror", "رعب")),
        Genre("scifi", "خيال علمي", "Sci-Fi", listOf("sci-fi", "sci fi", "science fiction", "scifi", "خيال علمي")),
        Genre("romance", "رومانسي", "Romance", listOf("romance", "romantic", "رومانسي", "رومانسية")),
        Genre("animation", "أنيميشن", "Animation", listOf("animation", "animated", "anime", "cartoon", "انيمي", "أنيمي", "انمي", "رسوم متحركة")),
        Genre("family", "عائلي", "Family", listOf("family", "عائلي", "عائلة")),
        Genre("crime", "جريمة", "Crime", listOf("crime", "جريمة", "جرائم")),
        Genre("mystery", "غموض", "Mystery", listOf("mystery", "غموض")),
        Genre("documentary", "وثائقي", "Documentary", listOf("documentary", "وثائقي")),
        Genre("history", "تاريخي", "History", listOf("history", "historical", "تاريخي")),
        Genre("war", "حربي", "War", listOf("war", "حربي", "حروب")),
        Genre("fantasy", "فانتازيا", "Fantasy", listOf("fantasy", "فانتازيا"))
    )

    private fun normalize(value: String): String = value.lowercase(Locale.ROOT)
        .replace('أ','ا').replace('إ','ا').replace('آ','ا')
        .replace('ة','ه').replace('ى','ي').replace('_', ' ')

    private fun includesToken(haystack: String, token: String): Boolean {
        var index = haystack.indexOf(token)
        while (index >= 0) {
            val end = index + token.length
            val leftOk = index == 0 || !haystack[index - 1].isLetterOrDigit()
            val rightOk = end == haystack.length || !haystack[end].isLetterOrDigit()
            if (leftOk && rightOk) return true
            index = haystack.indexOf(token, index + 1)
        }
        return false
    }

    fun identify(genreText: String?, categoryName: String? = null): Set<String> {
        val source = normalize(listOfNotNull(genreText, categoryName).joinToString(" ; "))
        if (source.isBlank()) return emptySet()
        return genres.asSequence().filter { genre ->
            genre.aliases.any { alias -> includesToken(source, normalize(alias)) }
        }.map { it.key }.toSet()
    }

    fun label(raw: String, arabic: Boolean): String {
        if (!arabic) return raw
        val keys = identify(raw)
        if (keys.size != 1) return raw
        return genres.firstOrNull { it.key in keys }?.arabic ?: raw
    }

    /**
     * SQL keyset paging: never load 24,000 films into RAM just to select a genre.
     * Aliases are hard-coded above; user/provider strings are bound arguments.
     * Includes provider category labels when the imported film lacks a genre.
     */
    fun catalogQuery(
        providerId: String,
        categoryId: String?,
        genreKey: String,
        afterRowId: Long = 0L,
        limit: Int = 64,
        countOnly: Boolean = false
    ): SimpleSQLiteQuery {
        val genre = genres.firstOrNull { it.key == genreKey }
            ?: throw IllegalArgumentException("Unknown movie genre")
        val args = ArrayList<Any>()
        val sql = StringBuilder(
            if (countOnly) "SELECT COUNT(*) FROM streams s " else "SELECT s.* FROM streams s "
        )
        sql.append("WHERE s.providerId = ? AND s.kind = 'movie' ")
        args += providerId
        if (categoryId != null) {
            sql.append("AND s.categoryId = ? ")
            args += categoryId
        }
        if (!countOnly) {
            sql.append("AND s.rowid > ? ")
            args += afterRowId
        }
        sql.append("AND (")
        genre.aliases.forEachIndexed { index, alias ->
            if (index > 0) sql.append(" OR ")
            sql.append("(s.genre LIKE ? COLLATE NOCASE OR EXISTS (")
            sql.append("SELECT 1 FROM categories c WHERE c.providerId=s.providerId ")
            sql.append("AND c.kind='movie' AND c.remoteId=s.categoryId ")
            sql.append("AND c.name LIKE ? COLLATE NOCASE))")
            val pattern = "%" + alias.replace("%", "\\%").replace("_", "\\_") + "%"
            args += pattern
            args += pattern
        }
        sql.append(") ")
        if (!countOnly) {
            sql.append("ORDER BY s.rowid LIMIT ?")
            args += limit.coerceIn(1, 128)
        }
        return SimpleSQLiteQuery(sql.toString(), args.toArray())
    }
}
