package tv.blofy.player.core.identity

import android.content.Context
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

    suspend fun registerIfNeeded(context: Context) {
        val endpoint = BuildConfig.ACTIVATION_BASE_URL.trim()
        if (endpoint.isBlank()) return
        val appContext = context.applicationContext
        val dao = BlofyDatabase.get(appContext).dao()
        val manager = ActivationManager(appContext, dao)
        val api = ActivationRemoteClient.create(endpoint)
        var local = manager.ensureIdentity()
        local = runCatching { manager.migrateStableIdentityIfNeeded(api, local) }.getOrDefault(local)
        if (!shouldRegister(local)) return
        runCatching {
            manager.refresh(api, BuildConfig.VERSION_NAME)
        }
    }
}
