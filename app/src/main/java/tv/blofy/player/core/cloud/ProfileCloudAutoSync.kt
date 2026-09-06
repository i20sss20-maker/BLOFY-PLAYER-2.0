package tv.blofy.player.core.cloud

import android.content.Context
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import tv.blofy.player.core.profile.ProfileStore
import java.util.concurrent.ConcurrentHashMap

/**
 * Debounced profile-cloud push for user edits. It never blocks the UI and collapses bursts such as
 * reordering several Home rows into one network sync. Guest profiles remain local-only.
 */
object ProfileCloudAutoSync {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val jobs = ConcurrentHashMap<String, Job>()

    fun schedule(context: Context, profileId: String = ProfileStore.storageNamespace(context)) {
        val app = context.applicationContext
        val profile = ProfileStore.all(app).firstOrNull { it.id == profileId } ?: return
        if (profile.guest) return

        jobs.remove(profileId)?.cancel()
        val job = scope.launch {
            delay(DEBOUNCE_MS)
            runCatching {
                val endpoint = tv.blofy.player.BuildConfig.ACTIVATION_BASE_URL.trim()
                if (endpoint.isNotBlank()) ProfileCloudSync.sync(app, endpoint, profileId)
            }
            jobs.remove(profileId, coroutineContext[Job])
        }
        jobs[profileId] = job
    }

    fun cancel(profileId: String) {
        jobs.remove(profileId)?.cancel()
    }

    private const val DEBOUNCE_MS = 1_250L
}
