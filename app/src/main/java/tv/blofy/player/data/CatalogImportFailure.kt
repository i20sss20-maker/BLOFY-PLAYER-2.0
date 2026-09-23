package tv.blofy.player.data

import android.database.sqlite.SQLiteDiskIOException
import android.database.sqlite.SQLiteFullException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.withContext

/** Catalog-only failure handling. Never reinterpret network IO as a storage error. */
internal object CatalogImportFailure {
    fun isStorageFailure(error: Throwable): Boolean {
        var current: Throwable? = error
        repeat(8) {
            when (current) {
                is SQLiteFullException, is SQLiteDiskIOException -> return true
            }
            val next = current?.cause
            if (next == null || next === current) return false
            current = next
        }
        return false
    }

    /** A failed new-account switch must not masquerade as success by opening the old account. */
    fun canReopenPrevious(firstLoad: Boolean, explicitReplacement: Boolean, error: Throwable): Boolean =
        !firstLoad && !explicitReplacement && !isStorageFailure(error)

    /** Cleanup can itself fail (notably on SQLite FULL). Keep the original cause for the caller. */
    suspend fun cleanupPreserving(primary: Throwable, cleanup: suspend () -> Unit) {
        withContext(NonCancellable + Dispatchers.IO) {
            try {
                cleanup()
            } catch (secondary: Exception) {
                if (secondary !== primary) primary.addSuppressed(secondary)
            }
        }
    }
}
