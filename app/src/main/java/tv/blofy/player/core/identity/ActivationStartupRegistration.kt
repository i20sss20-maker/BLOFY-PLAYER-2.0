package tv.blofy.player.core.identity

import android.content.Context
import android.util.Log
import kotlinx.coroutines.CancellationException
import tv.blofy.player.BuildConfig
import tv.blofy.player.data.local.ActivationEntity
import tv.blofy.player.data.local.BlofyDatabase

/**
 * Registers a fresh BLOFY installation with the activation service as soon as the app process
 * starts. This runs asynchronously and never blocks the Login screen or catalog startup.
 *
 * Upgraded installations first attempt the one-time authenticated move from their legacy random
 * identity to the reinstall-stable identity. If that network operation fails, the legacy identity
 * remains untouched and usable; a later refresh can retry safely.
 */
object ActivationStartupRegistration {
    internal fun shouldRegister(state: ActivationEntity): Boolean =
        !state.activated && state.expiresAt == null

    suspend fun registerIfNeeded(context: Context) = attempt {
        val endpoint = BuildConfig.ACTIVATION_BASE_URL.trim()
        if (endpoint.isBlank()) return@attempt
        val appContext = context.applicationContext
        val dao = BlofyDatabase.get(appContext).dao()
        val manager = ActivationManager(appContext, dao)
        val api = ActivationRemoteClient.create(endpoint)
        var local = manager.ensureIdentity()
        try {
            local = manager.migrateStableIdentityIfNeeded(api, local)
        } catch (cancelled: CancellationException) { throw cancelled }
        catch (_: Exception) { /* The existing identity remains valid for a later retry. */ }
        if (shouldRegister(local)) manager.refresh(api, BuildConfig.VERSION_NAME)
    }

    /** Optional startup work must not kill the process when local storage or the network fails. */
    internal suspend fun attempt(block: suspend () -> Unit) {
        try { block() }
        catch (cancelled: CancellationException) { throw cancelled }
        catch (error: Exception) {
            // No exception message/URL: provider and activation credentials may be embedded.
            Log.w("BlofyStartup", "Registration deferred: ${error.javaClass.simpleName}")
        }
    }
}
