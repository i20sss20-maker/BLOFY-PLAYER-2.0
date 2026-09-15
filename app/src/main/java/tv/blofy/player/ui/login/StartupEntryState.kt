package tv.blofy.player.ui.login

import android.app.Activity
import android.app.Application
import android.content.Context
import android.os.Bundle
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import tv.blofy.player.core.identity.ActivationManager
import tv.blofy.player.data.CatalogSyncState
import tv.blofy.player.data.local.BlofyDatabase
import tv.blofy.player.ui.home.HomeActivity

/**
 * Small synchronous startup hint written only after Home has proved that the active provider,
 * cached activation lease and local catalog are usable. Splash reads only SharedPreferences so
 * returning users never wait for Room or the network just to skip the login screen.
 */
object StartupEntryState {
    private const val PREFS = "blofy_startup_entry"
    private const val KEY_READY = "ready"
    private const val KEY_PROVIDER_ID = "provider_id"
    private const val KEY_EXPIRES_AT = "expires_at"
    private const val LIFETIME = Long.MAX_VALUE

    fun shouldOpenHome(context: Context, nowMs: Long = System.currentTimeMillis()): Boolean {
        val prefs = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        if (!prefs.getBoolean(KEY_READY, false)) return false
        if (prefs.getString(KEY_PROVIDER_ID, null).isNullOrBlank()) return false
        val expiresAt = prefs.getLong(KEY_EXPIRES_AT, 0L)
        return expiresAt == LIFETIME || expiresAt > nowMs
    }

    fun rememberReady(context: Context, providerId: String, expiresAt: Long?) {
        if (providerId.isBlank()) return clear(context)
        context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit()
            .putBoolean(KEY_READY, true)
            .putString(KEY_PROVIDER_ID, providerId)
            .putLong(KEY_EXPIRES_AT, expiresAt ?: LIFETIME)
            .apply()
    }

    fun clear(context: Context) {
        context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().clear().apply()
    }
}

/** Keeps the startup hint aligned with the active local provider without adding work to Splash. */
class StartupEntryLifecycle : Application.ActivityLifecycleCallbacks {
    override fun onActivityResumed(activity: Activity) {
        if (activity !is HomeActivity || activity !is AppCompatActivity) return
        activity.lifecycleScope.launch {
            val result = withContext(Dispatchers.IO) {
                runCatching {
                    val context = activity.applicationContext
                    val dao = BlofyDatabase.get(context).dao()
                    val providerId = dao.activeProviderId() ?: return@runCatching null
                    val activation = dao.activation() ?: return@runCatching null
                    val allowed = ActivationManager(context, dao).cachedCanUse(activation)
                    val ready = allowed && CatalogSyncState.isEntryReady(context, providerId) &&
                        dao.hasStreamsForProvider(providerId)
                    if (ready) providerId to activation.expiresAt else null
                }.getOrNull()
            }
            if (activity.isFinishing || activity.isDestroyed) return@launch
            if (result == null) StartupEntryState.clear(activity)
            else StartupEntryState.rememberReady(activity, result.first, result.second)
        }
    }

    override fun onActivityCreated(activity: Activity, savedInstanceState: Bundle?) = Unit
    override fun onActivityStarted(activity: Activity) = Unit
    override fun onActivityPaused(activity: Activity) = Unit
    override fun onActivityStopped(activity: Activity) = Unit
    override fun onActivitySaveInstanceState(activity: Activity, outState: Bundle) = Unit
    override fun onActivityDestroyed(activity: Activity) = Unit
}
