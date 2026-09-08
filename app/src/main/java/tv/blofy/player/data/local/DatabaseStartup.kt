package tv.blofy.player.data.local

import android.content.Context
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob

/** No destructive recovery: opening/migrating the existing database is shared across screens. */
internal object DatabaseStartup {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var initializer: BlockingStartupTask? = null

    @Synchronized
    private fun task(context: Context): BlockingStartupTask = initializer ?: run {
        val app = context.applicationContext
        BlockingStartupTask(scope) { BlofyDatabase.get(app).openHelper.writableDatabase; Unit }
            .also { initializer = it }
    }

    fun start(context: Context) { task(context).start() }
    suspend fun awaitReady(context: Context, timeoutMs: Long): Boolean = task(context).awaitReady(timeoutMs)
}
