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
        val temporaryBytes = cacheRoots(app).sumOf(::sizeOf)
        return StorageStats(databaseBytes, temporaryBytes,
            databaseBytes + artworkBytes + persistent + temporaryBytes, artworkBytes, persistent)
    }

    fun format(context: Context, bytes: Long): String =
        Formatter.formatFileSize(context.applicationContext, bytes.coerceAtLeast(0L))

    /**
     * Opportunistic cache maintenance for long-running TV boxes. Only temporary cache roots are
     * touched; pinned library artwork, Room databases, provider credentials and playback state are
     * never candidates. Newest files are preserved so visible posters stay warm.
     */
    fun trimTemporaryIfNeeded(context: Context): Long {
        val app = context.applicationContext
        val roots = cacheRoots(app)
        val limit = when {
            DeviceClass.isLowMemory(app) -> 96L * 1024L * 1024L
            app.filesDir.usableSpace < 512L * 1024L * 1024L -> 128L * 1024L * 1024L
            else -> 260L * 1024L * 1024L
        }
        val current = roots.sumOf(::sizeOf)
        if (current <= limit) return 0L

        val target = (limit * 3L / 4L).coerceAtLeast(48L * 1024L * 1024L)
        val files = roots.flatMap(::allFiles).sortedBy { it.lastModified() }
        var remaining = current
        var freed = 0L
        for (file in files) {
            if (remaining <= target) break
            val bytes = file.length().coerceAtLeast(0L)
            if (runCatching { file.delete() }.getOrDefault(false)) {
                remaining -= bytes
                freed += bytes
            }
        }
        roots.forEach(::removeEmptyDirectories)
        return freed
    }

    /** Keeps pinned artwork, providers, activation, favorites, episodes and watch progress. */
    suspend fun cleanSafely(context: Context) {
        val app = context.applicationContext
        clearChildren(app.cacheDir)
        app.externalCacheDir?.let(::clearChildren)
        val dao = BlofyDatabase.get(app).dao()
        dao.allProviders().first().forEach { dao.clearProviderEpg(it.id) }
    }

    private fun cacheRoots(context: Context): List<File> =
        listOfNotNull(context.cacheDir, context.externalCacheDir).distinctBy { it.absolutePath }

    private fun allFiles(root: File): List<File> {
        if (!root.exists()) return emptyList()
        if (root.isFile) return listOf(root)
        return root.listFiles()?.flatMap(::allFiles).orEmpty()
    }

    private fun removeEmptyDirectories(root: File) {
        if (!root.isDirectory) return
        root.listFiles()?.filter(File::isDirectory)?.forEach(::removeEmptyDirectories)
        if (root.listFiles()?.isEmpty() == true && root != root.parentFile) runCatching { root.delete() }
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
