package tv.blofy.player.data

import android.content.Context
import android.text.format.Formatter
import kotlinx.coroutines.flow.first
import tv.blofy.player.core.device.DeviceClass
import tv.blofy.player.data.local.BlofyDatabase
import java.io.File

object LocalStorageManager {
    data class StorageStats(
        val databaseBytes: Long,
        val temporaryBytes: Long,
        val totalBytes: Long,
        val artworkBytes: Long = 0L,
        val otherPersistentBytes: Long = 0L,
    )

    /** Includes all catalog/metadata/journal databases, WALs, pinned artwork and preferences. */
    fun stats(context: Context): StorageStats {
        val app = context.applicationContext
        val root = app.filesDir.parentFile
        val databaseBytes = sizeOf(app.getDatabasePath("blofy-player-2.db").parentFile)
        val artwork = File(app.filesDir, "blofy_library_art")
        val artworkBytes = sizeOf(artwork)
        val otherFiles = app.filesDir.listFiles()?.filterNot { it == artwork }?.sumOf(::sizeOf) ?: 0L
        val persistent = otherFiles + sizeOf(root?.let { File(it, "shared_prefs") })
        val temporaryBytes = listOfNotNull(app.cacheDir, app.externalCacheDir).distinctBy { it.absolutePath }.sumOf(::sizeOf)
        return StorageStats(databaseBytes, temporaryBytes,
            databaseBytes + artworkBytes + persistent + temporaryBytes, artworkBytes, persistent)
    }

    fun format(context: Context, bytes: Long): String =
        Formatter.formatFileSize(context.applicationContext, bytes.coerceAtLeast(0L))

    /**
     * Deep metadata/artwork enrichment is optional. Keep a larger reserve on low-memory boxes so
     * SQLite WAL growth, image decoding and Android itself never compete for the last free space.
     */
    fun hasHealthyFreeSpace(context: Context): Boolean {
        val app = context.applicationContext
        val reserve = if (DeviceClass.isLowMemory(app)) 192L * 1024L * 1024L else 128L * 1024L * 1024L
        return app.filesDir.usableSpace >= reserve
    }

    /** Keeps pinned artwork, providers, activation, favorites, episodes and watch progress. */
    suspend fun cleanSafely(context: Context) {
        val app = context.applicationContext
        clearChildren(app.cacheDir)
        app.externalCacheDir?.let(::clearChildren)
        val dao = BlofyDatabase.get(app).dao()
        dao.allProviders().first().forEach { dao.clearProviderEpg(it.id) }
    }

    /**
     * Automatic housekeeping only trims expendable cache files. It never touches the catalog,
     * activation, profile data, watch state, episodes or pinned library artwork.
     */
    fun trimTemporaryIfNeeded(context: Context): Long {
        val app = context.applicationContext
        val lowMemory = DeviceClass.isLowMemory(app)
        val lowSpace = app.cacheDir.usableSpace < 512L * 1024L * 1024L
        val limit = when {
            lowMemory -> 96L * 1024L * 1024L
            lowSpace -> 128L * 1024L * 1024L
            else -> 260L * 1024L * 1024L
        }
        val targets = listOfNotNull(app.cacheDir, app.externalCacheDir).distinctBy { it.absolutePath }
        val files = targets.flatMap { root -> root.walkTopDown().filter { it.isFile }.toList() }
        var total = files.sumOf { it.length() }
        if (total <= limit) return 0L
        val before = total
        files.sortedBy { it.lastModified() }.forEach { file ->
            if (total <= limit) return@forEach
            val bytes = file.length()
            if (runCatching { file.delete() }.getOrDefault(false)) total -= bytes
        }
        return (before - total).coerceAtLeast(0L)
    }

    private fun sizeOf(file: File?): Long {
        if (file == null || !file.exists()) return 0L
        if (file.isFile) return file.length()
        return file.listFiles()?.sumOf(::sizeOf) ?: 0L
    }

    private fun clearChildren(directory: File) {
        directory.listFiles()?.forEach { child -> runCatching { child.deleteRecursively() } }
    }
}
