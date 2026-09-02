package tv.blofy.player.data

import android.content.Context
import android.text.format.Formatter
import kotlinx.coroutines.flow.first
import tv.blofy.player.data.local.BlofyDatabase
import java.io.File

object LocalStorageManager {
    data class StorageStats(
        val databaseBytes: Long,
        val temporaryBytes: Long,
        val totalBytes: Long
    )

    fun stats(context: Context): StorageStats {
        val app = context.applicationContext
        val databaseBytes = databaseFiles(app).sumOf(::sizeOf)
        val temporaryBytes = listOfNotNull(app.cacheDir, app.externalCacheDir).sumOf(::sizeOf)
        return StorageStats(
            databaseBytes = databaseBytes,
            temporaryBytes = temporaryBytes,
            totalBytes = databaseBytes + temporaryBytes
        )
    }

    fun format(context: Context, bytes: Long): String =
        Formatter.formatFileSize(context.applicationContext, bytes.coerceAtLeast(0L))

    /**
     * Safe cleanup only removes disposable files and EPG rows. It deliberately keeps
     * providers, activation, favorites, watch progress and the cached catalog so the
     * customer can clean storage without turning the next app launch into a full reload.
     */
    suspend fun cleanSafely(context: Context) {
        val app = context.applicationContext
        clearChildren(app.cacheDir)
        app.externalCacheDir?.let(::clearChildren)

        val dao = BlofyDatabase.get(app).dao()
        dao.allProviders().first().forEach { provider ->
            dao.clearProviderEpg(provider.id)
        }
    }

    private fun databaseFiles(context: Context): List<File> {
        val main = context.getDatabasePath(DATABASE_NAME)
        return listOf(
            main,
            File(main.path + "-wal"),
            File(main.path + "-shm")
        )
    }

    private fun sizeOf(file: File): Long {
        if (!file.exists()) return 0L
        if (file.isFile) return file.length()
        return file.listFiles()?.sumOf(::sizeOf) ?: 0L
    }

    private fun clearChildren(directory: File) {
        directory.listFiles()?.forEach { child ->
            runCatching { child.deleteRecursively() }
        }
    }

    private const val DATABASE_NAME = "blofy-player-2.db"
}
