package tv.blofy.player

import android.app.Application
import android.content.Context
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import tv.blofy.player.core.commercial.CommercialConfigRepository
import tv.blofy.player.core.commercial.CrashRecovery
import tv.blofy.player.core.remote.QuickMenuInterceptor
import tv.blofy.player.core.update.AppUpdateLifecycle
import tv.blofy.player.data.ContentRepository
import tv.blofy.player.data.ResumeStateWriter
import tv.blofy.player.data.local.BlofyDatabase

class BlofyApp : Application() {
    private val applicationScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    val resumeStateWriter: ResumeStateWriter by lazy {
        val repository = ContentRepository(BlofyDatabase.get(this).dao())
        ResumeStateWriter(applicationScope) { request ->
            repository.saveResume(
                contentKey = request.contentKey,
                providerId = request.providerId,
                kind = request.kind,
                positionMs = request.positionMs,
                durationMs = request.durationMs
            )
        }
    }

    override fun onCreate() {
        super.onCreate()
        current = this
        CrashRecovery.install(this)
        registerActivityLifecycleCallbacks(QuickMenuInterceptor())
        registerActivityLifecycleCallbacks(AppUpdateLifecycle())

        // Absolutely no Room open, migration, catalog repair, artwork preload or network wait is
        // allowed from Application startup. Catalog maintenance is started only after a screen has
        // successfully opened the database and the UI is already interactive.
        applicationScope.launch {
            // Last-known-good config means an unavailable server never disables the app.
            runCatching { CommercialConfigRepository.refresh(this@BlofyApp) }
        }
    }

    companion object {
        @Volatile private var current: BlofyApp? = null
        fun contextOrNull(): Context? = current?.applicationContext
    }
}
