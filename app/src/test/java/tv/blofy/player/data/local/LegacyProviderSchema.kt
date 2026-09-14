package tv.blofy.player.data.local

import android.database.sqlite.SQLiteDatabase

/** Restore the actual published provider schema before exercising upgrade paths. */
internal fun restoreV11Providers(db: SQLiteDatabase) {
    val fields = "id,name,baseUrl,username,password,providerType,liveFormat,preferredTransport,preferredEngine,allowCrossProtocolRedirects,enabled,updatedAt"
    db.execSQL("""CREATE TABLE providers_legacy (
        id TEXT NOT NULL PRIMARY KEY, name TEXT NOT NULL, baseUrl TEXT NOT NULL,
        username TEXT NOT NULL, password TEXT NOT NULL, providerType TEXT NOT NULL,
        liveFormat TEXT NOT NULL, preferredTransport TEXT NOT NULL, preferredEngine TEXT NOT NULL,
        allowCrossProtocolRedirects INTEGER NOT NULL, enabled INTEGER NOT NULL, updatedAt INTEGER NOT NULL)""")
    db.execSQL("INSERT INTO providers_legacy ($fields) SELECT $fields FROM providers")
    db.execSQL("DROP TABLE providers")
    db.execSQL("ALTER TABLE providers_legacy RENAME TO providers")
}
