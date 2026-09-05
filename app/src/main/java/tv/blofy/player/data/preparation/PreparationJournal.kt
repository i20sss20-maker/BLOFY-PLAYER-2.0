package tv.blofy.player.data.preparation

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import java.security.MessageDigest

/** Private resumable ledger, independent from the playback/catalog schema. No log contains URLs. */
class PreparationJournal(context: Context) : SQLiteOpenHelper(context.applicationContext, "blofy-preparation-v1.db", null, 1) {
    override fun onCreate(db: SQLiteDatabase) {
        db.execSQL("CREATE TABLE runs(provider TEXT PRIMARY KEY NOT NULL,generation TEXT NOT NULL)")
        db.execSQL("CREATE TABLE units(provider TEXT NOT NULL,kind TEXT NOT NULL,item TEXT NOT NULL,value TEXT NOT NULL DEFAULT '',done INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(provider,kind,item))")
        db.execSQL("CREATE INDEX units_pending ON units(provider,kind,done)")
    }
    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) = Unit
    fun begin(provider: String, generation: String) {
        val db = writableDatabase
        db.beginTransaction()
        try {
            val old = db.rawQuery("SELECT generation FROM runs WHERE provider=?", arrayOf(provider)).use { if (it.moveToFirst()) it.getString(0) else null }
            if (old != generation) {
                db.delete("units", "provider=?", arrayOf(provider))
                db.insertWithOnConflict("runs", null, ContentValues().apply { put("provider", provider); put("generation", generation) }, SQLiteDatabase.CONFLICT_REPLACE).also { check(it != -1L) }
            }
            db.setTransactionSuccessful()
        } finally { db.endTransaction() }
    }
    fun enqueue(provider: String, kind: String, key: String, value: String = "") {
        writableDatabase.execSQL("INSERT OR IGNORE INTO units(provider,kind,item,value) VALUES(?,?,?,?)", arrayOf(provider, kind, key, value))
    }
    fun done(provider: String, kind: String, key: String): Boolean = readableDatabase.rawQuery(
        "SELECT done FROM units WHERE provider=? AND kind=? AND item=?", arrayOf(provider, kind, key)
    ).use { it.moveToFirst() && it.getInt(0) == 1 }
    fun complete(provider: String, kind: String, key: String) {
        val count = writableDatabase.update("units", ContentValues().apply { put("done", 1) }, "provider=? AND kind=? AND item=?", arrayOf(provider, kind, key))
        check(count == 1) { "Unable to persist preparation completion" }
    }
    fun reopen(provider: String, kind: String, key: String) {
        writableDatabase.update("units", ContentValues().apply { put("done", 0) }, "provider=? AND kind=? AND item=?", arrayOf(provider, kind, key))
    }
    fun counts(provider: String, kind: String): Pair<Long, Long> = readableDatabase.rawQuery(
        "SELECT COALESCE(SUM(done),0),COUNT(*) FROM units WHERE provider=? AND kind=?", arrayOf(provider, kind)
    ).use { it.moveToFirst(); it.getLong(0) to it.getLong(1) }
    /** Pagination includes completed rows, so one failed URL cannot trap this pass in a loop. */
    fun imagePage(provider: String, after: String, limit: Int = 40): List<Pair<String, String>> {
        require(limit > 0)
        return readableDatabase.rawQuery(
            "SELECT item,value FROM units WHERE provider=? AND kind='art' AND item>? ORDER BY item LIMIT ?", arrayOf(provider, after, limit.toString())
        ).use { cursor -> buildList { while (cursor.moveToNext()) add(cursor.getString(0) to cursor.getString(1)) } }
    }
    companion object {
        fun hash(value: String): String = MessageDigest.getInstance("SHA-256").digest(value.toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it) }
    }
}
