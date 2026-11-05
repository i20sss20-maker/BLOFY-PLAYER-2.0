package tv.blofy.player.data

import androidx.room.withTransaction
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import tv.blofy.player.data.local.BlofyDatabase
import tv.blofy.player.data.local.CategoryEntity
import tv.blofy.player.data.local.ProviderEntity
import tv.blofy.player.data.remote.XtreamApi
import tv.blofy.player.data.remote.XtreamClient
import tv.blofy.player.data.remote.readCatalog
import java.io.InputStreamReader
import java.net.URLEncoder
import java.nio.charset.StandardCharsets

/**
 * Explicit opt-in to use the lineup exported by get.php for channel/movie
 * positions while keeping Xtream metadata, playing URLs, and account state.
 *
 * A server that doesn't offer compatible M3U or returns an incomplete result
 * NEVER gets its saved order overwritten. All writes are transactional.
 */
internal class M3uOrderReconciler(
    private val database: BlofyDatabase,
    private val api: XtreamApi = XtreamClient.api
) {
    data class Result(
        val liveMatched: Int,
        val liveTotal: Int,
        val movieMatched: Int,
        val movieTotal: Int,
        val categoryMatches: Int,
        val seriesCategoriesMatched: Int
    ) {
        val anyMatched get() = liveMatched > 0 || movieMatched > 0 || seriesCategoriesMatched > 0
    }

    suspend fun apply(provider: ProviderEntity): Result = withContext(Dispatchers.IO) {
        require(provider.providerType.equals("xtream", true)) { "Xtream source required" }
        val base = provider.baseUrl.trim().trimEnd('/')
        val url = "$base/get.php?username=${enc(provider.username)}&password=${enc(provider.password)}&type=m3u_plus&output=ts"
        val snapshot = withTimeout(90_000L) {
            api.streamingCall(url).readCatalog { response ->
                val parser = M3uOriginalOrder()
                InputStreamReader(response.byteStream(), Charsets.UTF_8).buffered().use { reader ->
                    var scanned = 0
                    while (true) {
                        if (++scanned % 1024 == 0) currentCoroutineContext().ensureActive()
                        val line = reader.readLine() ?: break
                        parser.accept(line)
                    }
                }
                check(parser.validHeader) { "Source did not return M3U" }
                parser
            }
        }
        val dao = database.dao()
        val current = checkNotNull(dao.provider(provider.id)) { "Provider no longer exists" }
        check(current.baseUrl == provider.baseUrl &&
            current.username == provider.username && current.password == provider.password) {
            "Playlist was changed while checking the source order"
        }
        val liveTotal = dao.catalogCountAll(provider.id, "live")
        val movieTotal = dao.catalogCountAll(provider.id, "movie")
        val liveCategories = dao.categorySnapshot(provider.id, "live")
        val movieCategories = dao.categorySnapshot(provider.id, "movie")

        val live = if (liveTotal > 0) applyKind(provider.id, "live", snapshot.live, snapshot.liveGroups,
            liveCategories, liveTotal) else KindResult(0, 0)
        val movies = if (movieTotal > 0) applyKind(provider.id, "movie", snapshot.movie, snapshot.movieGroups,
            movieCategories, movieTotal) else KindResult(0, 0)
        val series = applySeriesCategoryOrder(provider.id, snapshot.seriesGroups,
            dao.categorySnapshot(provider.id, "series"))
        val result = Result(live.matched, liveTotal, movies.matched, movieTotal,
            live.categories + movies.categories + series, series)
        check(result.anyMatched) { "M3U order could not be matched to Xtream stream IDs" }
        result
    }

    private suspend fun applySeriesCategoryOrder(
        providerId: String,
        groups: Map<String, Int>,
        categories: List<CategoryEntity>
    ): Int = withContext(Dispatchers.IO) {
        if (groups.isEmpty() || categories.isEmpty()) return@withContext 0
        val uniqueNames = categories.groupBy { M3uOriginalOrder.normalizeGroup(it.name) }
            .filterValues { it.size == 1 }
        val matches = groups.mapNotNull { (group, rank) ->
            uniqueNames[group]?.singleOrNull()?.let { it to rank }
        }
        if (matches.size * 100 < categories.size * 65) return@withContext 0

        val sqlite = database.openHelper.writableDatabase
        sqlite.beginTransactionNonExclusive()
        try {
            sqlite.execSQL(
                "UPDATE categories SET orderIndex = orderIndex + 1000000 WHERE providerId = ? AND kind = 'series'",
                arrayOf<Any>(providerId)
            )
            val update = sqlite.compileStatement(
                "UPDATE categories SET orderIndex = ? WHERE providerId = ? AND kind = 'series' AND remoteId = ?"
            )
            try {
                for ((category, rank) in matches) {
                    currentCoroutineContext().ensureActive()
                    update.clearBindings()
                    update.bindLong(1, rank.toLong())
                    update.bindString(2, providerId)
                    update.bindString(3, category.remoteId)
                    update.executeUpdateDelete()
                }
            } finally { update.close() }
            sqlite.setTransactionSuccessful()
        } finally { sqlite.endTransaction() }
        matches.size
    }

    private data class KindResult(val matched: Int, val categories: Int)

    private suspend fun applyKind(
        providerId: String,
        kind: String,
        sourceOrder: Map<String, Long>,
        sourceGroups: Map<String, Int>,
        categoryRows: List<CategoryEntity>,
        total: Int
    ): KindResult {
        if (sourceOrder.size < 3) return KindResult(0, 0)
        // A playlist that has only a subset of the API's channels is not a safe
        // ordering source. At least 85% of saved IDs must match before committing.
        return withContext(Dispatchers.IO) {
            val sqlite = database.openHelper.writableDatabase
            var matched = 0
            var categoryMatched = 0
            sqlite.beginTransactionNonExclusive()
            try {
                val oldOffset = 1_000_000_000_000L
                sqlite.execSQL(
                    "UPDATE streams SET sourceOrder = sourceOrder + ? WHERE providerId = ? AND kind = ?",
                    arrayOf<Any>(oldOffset, providerId, kind)
                )
                val update = sqlite.compileStatement(
                    "UPDATE streams SET sourceOrder = ? WHERE providerId = ? AND kind = ? AND remoteId = ?"
                )
                try {
                    for ((streamId, position) in sourceOrder) {
                        if (matched % 256 == 0) currentCoroutineContext().ensureActive()
                        update.clearBindings()
                        update.bindLong(1, position)
                        update.bindString(2, providerId)
                        update.bindString(3, kind)
                        update.bindString(4, streamId)
                        if (update.executeUpdateDelete() > 0) matched++
                    }
                } finally { update.close() }
                // All-or-nothing per kind. Failed validation automatically rolls back.
                if (matched * 100 >= total * 85 && matched >= 3) {
                    val names = categoryRows.groupBy { M3uOriginalOrder.normalizeGroup(it.name) }
                        .filterValues { it.size == 1 }
                    val matches = sourceGroups.mapNotNull { (group, rank) ->
                        names[group]?.singleOrNull()?.let { it to rank }
                    }
                    if (categoryRows.isNotEmpty() && matches.size * 100 >= categoryRows.size * 65) {
                        sqlite.execSQL(
                            "UPDATE categories SET orderIndex = orderIndex + 1000000 WHERE providerId = ? AND kind = ?",
                            arrayOf<Any>(providerId, kind)
                        )
                        val statement = sqlite.compileStatement(
                            "UPDATE categories SET orderIndex = ? WHERE providerId = ? AND kind = ? AND remoteId = ?"
                        )
                        try {
                            for ((category, rank) in matches) {
                                statement.clearBindings()
                                statement.bindLong(1, rank.toLong())
                                statement.bindString(2, providerId)
                                statement.bindString(3, kind)
                                statement.bindString(4, category.remoteId)
                                statement.executeUpdateDelete()
                            }
                        } finally { statement.close() }
                        categoryMatched = matches.size
                    }
                    sqlite.setTransactionSuccessful()
                } else {
                    matched = 0
                }
            } finally {
                sqlite.endTransaction()
            }
            KindResult(matched, categoryMatched)
        }
    }

    private fun enc(value: String): String =
        URLEncoder.encode(value, StandardCharsets.UTF_8.name())
}
