package tv.blofy.player

import android.app.Application
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import tv.blofy.player.core.playback.SmartZappingInvalidator
import tv.blofy.player.core.remote.QuickMenuInterceptor
import tv.blofy.player.data.BackgroundCatalogEngine
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
        registerActivityLifecycleCallbacks(QuickMenuInterceptor())

        val database = BlofyDatabase.get(this)
        SmartZappingInvalidator.install(database)
        applicationScope.launch {
            database.openHelper
                .writableDatabase
                .execSQL("UPDATE streams SET locked = 0 WHERE locked != 0")
        }

        // Cached content remains immediately available; refresh/prefetch runs independently.
        BackgroundCatalogEngine.kick(this)
    }
}
