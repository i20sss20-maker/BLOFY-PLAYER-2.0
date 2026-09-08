package tv.blofy.player.ui.login

import android.app.Activity
import android.app.Application
import android.content.Intent
import android.os.Bundle
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.LinearLayout
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import tv.blofy.player.data.CatalogRefreshWorker
import tv.blofy.player.data.CatalogSyncState
import tv.blofy.player.data.local.BlofyDatabase
import tv.blofy.player.data.local.ProviderEntity
import tv.blofy.player.ui.home.HomeActivity

/**
 * Keeps the login screen local-first.
 *
 * LoginActivity may refresh activation/portal data from the network, but a saved provider with a
 * durable catalog must never wait for those calls before it can be opened. This lifecycle installs
 * an entry fast path without changing playback or catalog import code.
 */
class LoginLocalFastPathLifecycle : Application.ActivityLifecycleCallbacks {
    private val jobs = mutableMapOf<Activity, Job>()

    override fun onActivityResumed(activity: Activity) {
        if (activity !is LoginActivity) return
        jobs.remove(activity)?.cancel()
        jobs[activity] = activity.lifecycleScope.launch {
            installLocalSnapshot(activity)
            installConnectFastPath(activity)
            installPlaylistFastPath(activity)
        }
    }

    override fun onActivityPaused(activity: Activity) {
        jobs.remove(activity)?.cancel()
    }

    private suspend fun installLocalSnapshot(activity: LoginActivity) {
        val dao = BlofyDatabase.get(activity.applicationContext).dao()
        val providers = withTimeoutOrNull(LOCAL_READ_TIMEOUT_MS) {
            withContext(Dispatchers.IO) { dao.allProviders().first() }
        }.orEmpty()
        if (providers.isEmpty() || activity.isFinishing) return
        runCatching {
            val method = LoginActivity::class.java.getDeclaredMethod("renderPortalPlaylists", List::class.java)
            method.isAccessible = true
            method.invoke(activity, providers)
        }
    }

    private suspend fun installConnectFastPath(activity: LoginActivity) {
        val button = privateField<Button>(activity, "connectButton") ?: return
        button.setOnClickListener {
            activity.lifecycleScope.launch {
                val dao = BlofyDatabase.get(activity.applicationContext).dao()
                val provider = withTimeoutOrNull(LOCAL_READ_TIMEOUT_MS) {
                    withContext(Dispatchers.IO) { dao.providers().first().firstOrNull() }
                }
                if (provider != null && hasDurableCatalog(activity, provider.id)) {
                    openLocalProvider(activity, provider)
                } else {
                    invokeOriginalConnect(activity)
                }
            }
        }
    }

    private suspend fun installPlaylistFastPath(activity: LoginActivity) {
        val row = privateField<LinearLayout>(activity, "playlistRow") ?: return
        bindPlaylistChildren(activity, row)
        row.setOnHierarchyChangeListener(object : ViewGroup.OnHierarchyChangeListener {
            override fun onChildViewAdded(parent: View?, child: View?) {
                row.post { activity.lifecycleScope.launch { bindPlaylistChildren(activity, row) } }
            }
            override fun onChildViewRemoved(parent: View?, child: View?) = Unit
        })
    }

    private suspend fun bindPlaylistChildren(activity: LoginActivity, row: LinearLayout) {
        if (activity.isFinishing) return
        val dao = BlofyDatabase.get(activity.applicationContext).dao()
        val providers = withTimeoutOrNull(LOCAL_READ_TIMEOUT_MS) {
            withContext(Dispatchers.IO) { dao.allProviders().first() }
        }.orEmpty()
            .sortedWith(compareByDescending<ProviderEntity> { it.enabled }.thenByDescending { it.updatedAt })
        if (providers.isEmpty()) return

        val count = minOf(row.childCount, providers.size)
        for (index in 0 until count) {
            val card = row.getChildAt(index) ?: continue
            val provider = providers[index]
            card.setOnClickListener {
                activity.lifecycleScope.launch {
                    val latest = withTimeoutOrNull(LOCAL_READ_TIMEOUT_MS) {
                        withContext(Dispatchers.IO) { dao.provider(provider.id) }
                    } ?: provider
                    if (hasDurableCatalog(activity, latest.id)) {
                        openLocalProvider(activity, latest)
                    } else {
                        activity.startActivity(
                            Intent(activity, CatalogLoadingActivity::class.java)
                                .putExtra(CatalogLoadingActivity.EXTRA_PROVIDER_ID, latest.id)
                        )
                    }
                }
            }
        }
    }

    private suspend fun openLocalProvider(activity: LoginActivity, provider: ProviderEntity) {
        val dao = BlofyDatabase.get(activity.applicationContext).dao()
        withTimeoutOrNull(LOCAL_WRITE_TIMEOUT_MS) {
            withContext(Dispatchers.IO) { dao.saveAndActivateProvider(provider) }
        }
        if (CatalogSyncState.isReady(activity.applicationContext, provider.id).not()) {
            CatalogSyncState.markReady(activity.applicationContext, provider.id)
        }
        // A staged source update is maintenance, never an entry gate.
        CatalogRefreshWorker.enqueueNow(activity.applicationContext, provider.id)
        if (activity.isFinishing) return
        activity.startActivity(Intent(activity, HomeActivity::class.java))
        activity.finish()
    }

    private suspend fun hasDurableCatalog(activity: LoginActivity, providerId: String): Boolean {
        val dao = BlofyDatabase.get(activity.applicationContext).dao()
        return withTimeoutOrNull(LOCAL_READ_TIMEOUT_MS) {
            withContext(Dispatchers.IO) { dao.hasStreamsForProvider(providerId) }
        } == true
    }

    private fun invokeOriginalConnect(activity: LoginActivity) {
        runCatching {
            val method = LoginActivity::class.java.getDeclaredMethod("startOrCancelConnect")
            method.isAccessible = true
            method.invoke(activity)
        }
    }

    @Suppress("UNCHECKED_CAST")
    private fun <T> privateField(activity: LoginActivity, name: String): T? = runCatching {
        val field = LoginActivity::class.java.getDeclaredField(name)
        field.isAccessible = true
        field.get(activity) as? T
    }.getOrNull()

    override fun onActivityCreated(activity: Activity, savedInstanceState: Bundle?) = Unit
    override fun onActivityStarted(activity: Activity) = Unit
    override fun onActivityStopped(activity: Activity) = Unit
    override fun onActivitySaveInstanceState(activity: Activity, outState: Bundle) = Unit
    override fun onActivityDestroyed(activity: Activity) { jobs.remove(activity)?.cancel() }

    companion object {
        private const val LOCAL_READ_TIMEOUT_MS = 1_200L
        private const val LOCAL_WRITE_TIMEOUT_MS = 1_500L
    }
}
