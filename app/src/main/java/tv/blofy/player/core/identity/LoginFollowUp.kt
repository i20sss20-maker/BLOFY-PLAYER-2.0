package tv.blofy.player.core.identity

import android.content.Context
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import tv.blofy.player.BuildConfig
import tv.blofy.player.core.provider.RemoteProviderProfileClient
import tv.blofy.player.data.local.BlofyDatabase
import java.util.concurrent.ConcurrentHashMap

/** Entry never awaits optional HTTP. Results update stored state, not the Login view hierarchy. */
internal object LoginFollowUp {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val running = ConcurrentHashMap.newKeySet<String>()

    fun enqueue(context: Context, endpoint: String, providerId: String) {
        if (endpoint.isBlank() || !running.add(providerId)) return
        val app = context.applicationContext
        scope.launch {
            try {
                delay(1_000L)
                val dao = BlofyDatabase.get(app).dao()
                // Preserve existing entitlement handling: explicit remote denial is persisted and
                // is not converted to a successful offline activation.
                val status = ActivationManager(app, dao).refresh(ActivationRemoteClient.create(endpoint), BuildConfig.VERSION_NAME)
                if (!status.canUse()) return@launch
                val before = dao.provider(providerId) ?: return@launch
                val updated = RemoteProviderProfileClient.applyIfAvailable(app, endpoint, before)
                val current = dao.provider(providerId) ?: return@launch
                // Do not overwrite a website source edit or a newer playlist selection with an old
                // profile response. The original streaming engines and transport defaults are intact.
                if (current == before && updated != before) dao.upsertProvider(updated)
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (_: Exception) { /* Keep valid cached state; retry on the next entry. */ }
            finally { running.remove(providerId) }
        }
    }
}
