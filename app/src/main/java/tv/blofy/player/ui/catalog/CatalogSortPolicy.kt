package tv.blofy.player.ui.catalog

import androidx.sqlite.db.SimpleSQLiteQuery

/**
 * Whitelisted sort modes for optional movie/series catalog pages. Defaults to
 * the original provider rowid order so Android 9 boxes do not pay the cost
 * of a 24,000-row sort unless the viewer explicitly chooses one.
 *
 * All provider and category values are SQLite parameters, never SQL text.
 */
internal object CatalogSortPolicy {
    enum class Mode {
        SOURCE, NEWEST, RATING, YEAR;
        fun next(): Mode = entries[(ordinal + 1) % entries.size]
    }

    fun query(
        providerId: String,
        kind: String,
        categoryId: String?,
        mode: Mode,
        offset: Int,
        limit: Int
    ): SimpleSQLiteQuery {
        require(kind == "movie" || kind == "series") { "Not a film or series catalog" }
        require(mode != Mode.SOURCE) { "SOURCE uses the indexed keyset DAO query" }
        val order = when (mode) {
            Mode.NEWEST -> "COALESCE(s.addedAt, 0) DESC, s.rowid ASC"
            Mode.RATING -> "CAST(COALESCE(NULLIF(s.rating, ''), '0') AS REAL) DESC, s.rowid ASC"
            Mode.YEAR -> "CAST(COALESCE(NULLIF(s.year, ''), SUBSTR(s.releaseDate,1,4), '0') AS INTEGER) DESC, s.rowid ASC"
            Mode.SOURCE -> error("Unreachable")
        }
        val query = buildString {
            append("SELECT s.* FROM streams s WHERE s.providerId = ? AND s.kind = ?")
            if (categoryId != null) append(" AND s.categoryId = ?")
            append(" ORDER BY $order LIMIT ? OFFSET ?")
        }
        val args = mutableListOf<Any>(providerId, kind)
        if (categoryId != null) args.add(categoryId)
        args.add(limit.coerceIn(1, 128))
        args.add(offset.coerceAtLeast(0))
        return SimpleSQLiteQuery(query, args.toTypedArray())
    }
}
