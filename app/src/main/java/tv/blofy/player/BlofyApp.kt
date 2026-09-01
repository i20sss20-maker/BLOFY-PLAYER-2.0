package tv.blofy.player

import android.app.Application
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
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
        applicationScope.launch {
            val dao = BlofyDatabase.get(this@BlofyApp).dao()
            dao.allProviders().first().forEach { provider ->
                dao.allStreamsForProvider(provider.id)
                    .asSequence()
                    .filter { it.locked }
                    .forEach { dao.setLocked(it.key, false) }
            }
        }
    }
}
