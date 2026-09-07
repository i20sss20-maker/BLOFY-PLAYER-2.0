package tv.blofy.player.data.preparation

import android.app.Activity
import android.app.Application
import android.os.Bundle
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import tv.blofy.player.core.device.DeviceClass
import tv.blofy.player.data.local.BlofyDatabase
import tv.blofy.player.ui.home.HomeActivity
import java.io.File
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Keeps optional poster/cache storage bounded without touching durable catalog, profile or playback data.
 * Runs only after Home is interactive and never blocks activity startup.
 */
class StorageMaintenanceLifecycle : Application.ActivityLifecycleCallbacks {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val running = AtomicBoolean(false)
    @Volatile private var lastRunAt = 0L

    override fun onActivityResumed(activity: Activity) {
        if (activity !is HomeActivity) return
        val now = System.currentTimeMillis()
        if (now - lastRunAt < RUN_INTERVAL_MS) return
        if (!running.compareAndSet(false, true)) return
        lastRunAt = now
        val app = activity.applicationContext
        scope.launch {
            try {
                // Upgrade old plaintext provider rows only after Home is already usable. The DAO
                // transparently decrypts sealed rows for runtime use, so playback/catalog code stays
                // untouched while credentials become AES-GCM protected at rest.
                runCatching { BlofyDatabase.get(app).dao().hardenProviderSecrets() }
                trimPosterCache(app.cacheDir, if (DeviceClass.isLowMemory(app)) LOW_RAM_POSTER_CACHE_BYTES else NORMAL_POSTER_CACHE_BYTES)
                deleteStaleTemps(app.cacheDir, now)
            } finally {
                running.set(false)
            }
        }
    }

    private fun trimPosterCache(cacheDir: File, maxBytes: Long) {
        val dir = File(cacheDir, "blofy_posters")
        val files = dir.listFiles()?.asSequence()?.filter { it.isFile }?.toList() ?: return
        var total = files.sumOf(File::length)
        if (total <= maxBytes) return
        for (file in files.sortedBy(File::lastModified)) {
            if (total <= maxBytes) break
            val size = file.length()
            if (file.delete()) total -= size
        }
    }

    private fun deleteStaleTemps(root: File, now: Long) {
        var visited = 0
        val queue = ArrayDeque<File>()
        queue.add(root)
        while (queue.isNotEmpty() && visited < MAX_SCAN_ENTRIES) {
            val next = queue.removeFirst()
            val children = next.listFiles() ?: continue
            for (child in children) {
                if (++visited >= MAX_SCAN_ENTRIES) break
                if (child.isDirectory) {
                    queue.add(child)
                    continue
                }
                val stale = now - child.lastModified() >= STALE_TEMP_AGE_MS
                val temporary = child.name.endsWith(".tmp", true) || child.name.endsWith(".part", true) || child.name.endsWith(".download", true)
                if (stale && temporary) runCatching { child.delete() }
            }
        }
    }

    override fun onActivityCreated(activity: Activity, state: Bundle?) = Unit
    override fun onActivityStarted(activity: Activity) = Unit
    override fun onActivityPaused(activity: Activity) = Unit
    override fun onActivityStopped(activity: Activity) = Unit
    override fun onActivitySaveInstanceState(activity: Activity, state: Bundle) = Unit
    override fun onActivityDestroyed(activity: Activity) = Unit

    companion object {
        private const val RUN_INTERVAL_MS = 6L * 60L * 60L * 1000L
        private const val NORMAL_RAM_POSTER_CACHE_BYTES = 220L * 1024L * 1024L
        private const val LOW_RAM_POSTER_CACHE_BYTES = 96L * 1024L * 1024L
        private const val STALE_TEMP_AGE_MS = 24L * 60L * 60L * 1000L
        private const val MAX_SCAN_ENTRIES = 2_500

        // Keep the old symbol name for source compatibility with existing tests/callers.
        private const val NORMAL_POSTER_CACHE_BYTES = NORMAL_RAM_POSTER_CACHE_BYTES
    }
}
