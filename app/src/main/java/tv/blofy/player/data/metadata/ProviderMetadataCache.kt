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
    private const val DB_VERSION = 1
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
        helper(context).writableDatabase.insertWithOnConflict(TABLE, null, values, SQLiteDatabase.CONFLICT_REPLACE)
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
        }

        override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
            if (oldVersion < 1) onCreate(db)
        }
    }
}
