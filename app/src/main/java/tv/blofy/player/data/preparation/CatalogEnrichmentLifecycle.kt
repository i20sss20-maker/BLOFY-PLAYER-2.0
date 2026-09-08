package tv.blofy.player.data.preparation

import android.app.Activity
import android.app.Application
import android.content.Context
import android.os.Bundle
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import tv.blofy.player.core.device.DeviceClass
import tv.blofy.player.data.CatalogSyncState
import tv.blofy.player.data.LocalStorageManager
import tv.blofy.player.data.local.BlofyDatabase
import tv.blofy.player.ui.home.HomeActivity
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Derived catalog maintenance must never behave like a second foreground loader.
 *
 * A Home resume can happen repeatedly while the user opens details/player screens. Older builds
 * launched a new delayed enrichment coroutine on every resume, so several large Room/cache passes
 * could wake up together later and compete with DPAD, Live and category queries. Keep this work
 * strictly single-flight and rate-limited. The durable catalog remains the only entry requirement.
 */
class CatalogEnrichmentLifecycle : Application.ActivityLifecycleCallbacks {
    private val running = AtomicBoolean(false)
    @Volatile private var lastCompletedAt = 0L

    override fun onActivityResumed(activity: Activity) {
        if (activity !is HomeActivity) return
        val now = System.currentTimeMillis()
        if (now - lastCompletedAt < MIN_RUN_INTERVAL_MS) return
        if (!running.compareAndSet(false, true)) return

        activity.lifecycleScope.launch {
            try {
                val app = activity.applicationContext
                val provider = withContext(Dispatchers.IO) {
                    BlofyDatabase.get(app).dao().providers().first().firstOrNull()
                        ?.takeIf { CatalogSyncState.isEntryReady(app, it.id) }
                } ?: return@launch

                // Match the stable TV-app pattern: first render and navigation own the machine.
                // Expensive derived caches wait until the screen has been quiet for a while.
                delay(if (DeviceClass.isLowMemory(app)) LOW_MEMORY_QUIET_PERIOD_MS else NORMAL_QUIET_PERIOD_MS)
                if (activity.isFinishing || !activity.lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED)) return@launch

                withContext(Dispatchers.IO) {
                    val prefs = app.getSharedPreferences(STORAGE_PREFS, Context.MODE_PRIVATE)
                    val maintenanceNow = System.currentTimeMillis()
                    val lastTrim = prefs.getLong(KEY_LAST_TRIM_AT, 0L)
                    val urgent = !LocalStorageManager.hasHealthyFreeSpace(app)
                    if (urgent || maintenanceNow - lastTrim >= STORAGE_TRIM_INTERVAL_MS) {
                        runCatching { LocalStorageManager.trimTemporaryIfNeeded(app) }
                        prefs.edit().putLong(KEY_LAST_TRIM_AT, maintenanceNow).apply()
                    }
                }
                if (!LocalStorageManager.hasHealthyFreeSpace(app)) return@launch
                if (activity.isFinishing || !activity.lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED)) return@launch

                if (!CatalogSyncState.isEntryCachesReady(app, provider.id)) {
                    runCatching { FullCatalogPreparer.prepare(app, provider.id) { } }
                }
                if (!activity.isFinishing && activity.lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED)) {
                    FullCatalogPreparer.resumeBackground(app, provider.id)
                }
                lastCompletedAt = System.currentTimeMillis()
            } finally {
                running.set(false)
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
        private const val STORAGE_PREFS = "blofy_storage_maintenance_v1"
        private const val KEY_LAST_TRIM_AT = "last_trim_at"
        private const val STORAGE_TRIM_INTERVAL_MS = 6L * 60L * 60L * 1000L
        private const val MIN_RUN_INTERVAL_MS = 10L * 60L * 1000L
        private const val NORMAL_QUIET_PERIOD_MS = 20_000L
        private const val LOW_MEMORY_QUIET_PERIOD_MS = 35_000L
    }
}
