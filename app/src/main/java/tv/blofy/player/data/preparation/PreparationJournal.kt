package tv.blofy.player.data.preparation

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import java.io.Closeable
import tv.blofy.player.core.storage.StableHash

/** Private resumable ledger, independent from the playback/catalog schema. No log contains URLs. */
class PreparationJournal(context: Context) : SQLiteOpenHelper(context.applicationContext, "blofy-preparation-v1.db", null, 2), Closeable {
    init { setWriteAheadLoggingEnabled(true) }
    // The concrete helper owns this contract; do not depend on newer platform inheritance.
    override fun close() = super.close()

    override fun onCreate(db: SQLiteDatabase) {
        db.execSQL("CREATE TABLE runs(provider TEXT PRIMARY KEY NOT NULL,generation TEXT NOT NULL,epoch INTEGER NOT NULL DEFAULT 0)")
        db.execSQL("CREATE TABLE units(provider TEXT NOT NULL,kind TEXT NOT NULL,item TEXT NOT NULL,value TEXT NOT NULL DEFAULT '',done INTEGER NOT NULL DEFAULT 0,failed INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(provider,kind,item))")
        db.execSQL("CREATE INDEX units_pending ON units(provider,kind,done)")
    }
    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
        if (oldVersion < 2) {
            db.execSQL("ALTER TABLE units ADD COLUMN failed INTEGER NOT NULL DEFAULT 0")
            db.execSQL("ALTER TABLE runs ADD COLUMN epoch INTEGER NOT NULL DEFAULT 0")
        }
    }
    fun begin(provider: String, generation: String, epoch: Long = 0L) {
        val db = writableDatabase
        db.beginTransaction()
        try {
            val old = db.rawQuery("SELECT generation FROM runs WHERE provider=?", arrayOf(provider)).use { if (it.moveToFirst()) it.getString(0) else null }
            if (old != generation) {
                db.delete("units", "provider=?", arrayOf(provider))
                db.insertWithOnConflict("runs", null, ContentValues().apply { put("provider", provider); put("generation", generation) }, SQLiteDatabase.CONFLICT_REPLACE).also { check(it != -1L) }
            }
            db.execSQL("UPDATE runs SET epoch=? WHERE provider=?", arrayOf(epoch, provider))
            db.setTransactionSuccessful()
        } finally { db.endTransaction() }
    }
    fun enqueue(provider: String, kind: String, key: String, value: String = "") {
        writableDatabase.execSQL("INSERT OR IGNORE INTO units(provider,kind,item,value) VALUES(?,?,?,?)", arrayOf(provider, kind, key, value))
    }
    /** Commit all intents before starting a bounded page of network work. */
    fun enqueueBatch(provider: String, kind: String, items: List<Pair<String, String>>) {
        if (items.isEmpty()) return
        transaction { items.forEach { (key, value) -> enqueue(provider, kind, key, value) } }
    }

    /** A crash before this commit only causes a local-file check on retry, never a lost image. */
    fun finishBatch(provider: String, kind: String, saved: Collection<String>, failed: Collection<String> = emptyList()) {
        if (saved.isEmpty() && failed.isEmpty()) return
        transaction {
            saved.forEach { remove(provider, kind, it) }
            failed.forEach { key ->
                writableDatabase.execSQL("UPDATE units SET failed=1 WHERE provider=? AND kind=? AND item=?",
                    arrayOf(provider, kind, key))
            }
        }
    }

    private inline fun transaction(block: () -> Unit) {
        val db = writableDatabase
        db.beginTransaction()
        try { block(); db.setTransactionSuccessful() } finally { db.endTransaction() }
    }

    data class Progress(val pendingImages: Long, val pendingDetails: Long, val failed: Long)
    fun progress(provider: String): Progress = readableDatabase.rawQuery(
        "SELECT COALESCE(SUM(CASE WHEN kind='art' THEN 1 ELSE 0 END),0),COALESCE(SUM(CASE WHEN kind='detail' THEN 1 ELSE 0 END),0),COALESCE(SUM(failed),0) FROM units WHERE provider=? AND done=0",
        arrayOf(provider)
    ).use { it.moveToFirst(); Progress(it.getLong(0), it.getLong(1), it.getLong(2)) }

    fun progress(provider: String, epoch: Long): Progress {
        val current = readableDatabase.rawQuery("SELECT epoch FROM runs WHERE provider=?", arrayOf(provider))
            .use { it.moveToFirst() && it.getLong(0) == epoch }
        return if (current) progress(provider) else Progress(0, 0, 0)
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
    /** The full-library queue retains only missing units. Successful files are their own ledger. */
    fun remove(provider: String, kind: String, key: String) {
        writableDatabase.delete("units", "provider=? AND kind=? AND item=?", arrayOf(provider, kind, key))
    }
    data class Pending(val rowId: Long, val key: String, val value: String)
    fun pendingPage(provider: String, kind: String, after: Long, limit: Int): List<Pending> {
        require(limit > 0)
        return readableDatabase.rawQuery(
            "SELECT rowid,item,value FROM units WHERE provider=? AND kind=? AND done=0 AND rowid>? ORDER BY rowid LIMIT ?",
            arrayOf(provider, kind, after.toString(), limit.toString())
        ).use { cursor -> buildList {
            while (cursor.moveToNext()) add(Pending(cursor.getLong(0), cursor.getString(1), cursor.getString(2)))
        } }
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
        fun hash(value: String): String = StableHash.sha256(value)
    }
}
