package tv.blofy.player.data.metadata

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import com.google.gson.Gson

/**
 * Small persistent metadata store separate from the main catalog DB.
 * This avoids reopening or migrating the playback/catalog database while still making detail pages
 * fully local after the first provider preload. No credentials or playback URLs are stored here.
 */
object ProviderMetadataCache {
    private const val DB_NAME = "blofy-provider-metadata.db"
    private const val DB_VERSION = 2
    private const val TABLE = "content_metadata"
    private val gson = Gson()
    @Volatile private var helper: Helper? = null

    fun read(context: Context, contentKey: String): ProviderMetadata.Metadata? {
        if (contentKey.isBlank()) return null
        val db = helper(context).readableDatabase
        db.query(TABLE, arrayOf("payload_json"), "content_key = ?", arrayOf(contentKey), null, null, null, "1").use { cursor ->
            if (!cursor.moveToFirst()) return null
            val raw = cursor.getString(0).orEmpty()
            if (raw.isBlank()) return null
            return runCatching { gson.fromJson(raw, ProviderMetadata.Metadata::class.java) }.getOrNull()
        }
    }

    /**
     * Read a whole catalog page from one consistent local SQLite snapshot.
     * This is intentionally offline: a category switch or scroll must not
     * start a network request and change genre labels after a card is drawn.
     * SQLite bind-argument chunks also support large in-process page restores.
     * Call from Dispatchers.IO, never on the UI thread.
     */
    fun readGenresForPage(context: Context, contentKeys: List<String>): Map<String, List<String>> {
        if (contentKeys.isEmpty()) return emptyMap()
        val uniqueKeys = contentKeys.asSequence().filter(String::isNotBlank).distinct().toList()
        if (uniqueKeys.isEmpty()) return emptyMap()
        val results = LinkedHashMap<String, List<String>>()
        val db = helper(context).readableDatabase
        for (keys in uniqueKeys.chunked(128)) {
            val binds = List(keys.size) { "?" }.joinToString(",")
            db.query(
                TABLE,
                arrayOf("content_key", "payload_json"),
                "content_key IN ($binds)",
                keys.toTypedArray(),
                null, null, null
            ).use { cursor ->
                while (cursor.moveToNext()) {
                    val key = cursor.getString(0) ?: continue
                    val raw = cursor.getString(1).orEmpty()
                    if (raw.isBlank()) continue
                    val genres = runCatching {
                        gson.fromJson(raw, ProviderMetadata.Metadata::class.java)?.genres.orEmpty()
                    }.getOrDefault(emptyList())
                        .filter { it.isNotBlank() }
                    if (genres.isNotEmpty()) results[key] = genres
                }
            }
        }
        return results
    }

    fun contains(context: Context, contentKey: String): Boolean {
        if (contentKey.isBlank()) return false
        helper(context).readableDatabase.rawQuery(
            "SELECT 1 FROM $TABLE WHERE content_key = ? LIMIT 1",
            arrayOf(contentKey)
        ).use { return it.moveToFirst() }
    }

    fun write(context: Context, providerId: String, contentKey: String, metadata: ProviderMetadata.Metadata?) {
        if (providerId.isBlank() || contentKey.isBlank()) return
        val values = ContentValues().apply {
            put("content_key", contentKey)
            put("provider_id", providerId)
            put("payload_json", metadata?.let(gson::toJson).orEmpty())
            put("updated_at", System.currentTimeMillis())
        }
        check(helper(context).writableDatabase.insertWithOnConflict(TABLE, null, values, SQLiteDatabase.CONFLICT_REPLACE) != -1L) { "Unable to persist metadata" }
    }

    fun count(context: Context, providerId: String): Int {
        helper(context).readableDatabase.rawQuery(
            "SELECT COUNT(*) FROM $TABLE WHERE provider_id = ?",
            arrayOf(providerId)
        ).use { cursor -> return if (cursor.moveToFirst()) cursor.getInt(0) else 0 }
    }

    fun clearProvider(context: Context, providerId: String) {
        if (providerId.isBlank()) return
        helper(context).writableDatabase.delete(TABLE, "provider_id = ?", arrayOf(providerId))
        helper(context).writableDatabase.delete("detail_fetches", "provider_id = ?", arrayOf(providerId))
    }

    fun lastDetailFetch(context: Context, contentKey: String): Long =
        helper(context).readableDatabase.rawQuery(
            "SELECT fetched_at FROM detail_fetches WHERE content_key = ?", arrayOf(contentKey)
        ).use { if (it.moveToFirst()) it.getLong(0) else 0L }

    fun markDetailFetched(context: Context, contentKey: String, providerId: String) {
        helper(context).writableDatabase.insertWithOnConflict("detail_fetches", null, ContentValues().apply {
            put("content_key", contentKey)
            put("provider_id", providerId)
            put("fetched_at", System.currentTimeMillis())
        }, SQLiteDatabase.CONFLICT_REPLACE)
    }

    private fun helper(context: Context): Helper = helper ?: synchronized(this) {
        helper ?: Helper(context.applicationContext).also { helper = it }
    }

    private class Helper(context: Context) : SQLiteOpenHelper(context, DB_NAME, null, DB_VERSION) {
        override fun onCreate(db: SQLiteDatabase) {
            db.execSQL(
                "CREATE TABLE IF NOT EXISTS $TABLE (" +
                    "content_key TEXT PRIMARY KEY NOT NULL," +
                    "provider_id TEXT NOT NULL," +
                    "payload_json TEXT NOT NULL," +
                    "updated_at INTEGER NOT NULL)"
            )
            db.execSQL("CREATE INDEX IF NOT EXISTS index_content_metadata_provider_id ON $TABLE(provider_id)")
            createFetchTable(db)
        }

        private fun createFetchTable(db: SQLiteDatabase) {
            db.execSQL("CREATE TABLE IF NOT EXISTS detail_fetches (content_key TEXT PRIMARY KEY NOT NULL, provider_id TEXT NOT NULL, fetched_at INTEGER NOT NULL)")
        }

        override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
            if (oldVersion < 2) createFetchTable(db)
        }
    }
}
