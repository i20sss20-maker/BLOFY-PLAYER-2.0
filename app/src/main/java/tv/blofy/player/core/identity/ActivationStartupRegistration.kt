package tv.blofy.player.core.identity

import android.content.Context
import tv.blofy.player.BuildConfig
import tv.blofy.player.data.local.ActivationEntity
import tv.blofy.player.data.local.BlofyDatabase

/**
 * Registers a fresh BLOFY installation with the activation service as soon as the app process
 * starts. This runs asynchronously and never blocks the Login screen or catalog startup.
 *
 * Only a never-checked local identity is auto-registered. Existing active/trial, expired and
 * blocked states continue through their normal explicit refresh paths, avoiding repeated network
 * calls on every cold start.
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
        val local = manager.ensureIdentity()
        if (!shouldRegister(local)) return
        runCatching {
            manager.refresh(ActivationRemoteClient.create(endpoint), BuildConfig.VERSION_NAME)
        }
    }
}
