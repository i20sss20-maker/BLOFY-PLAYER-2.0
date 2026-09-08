package tv.blofy.player.data.local

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.async
import kotlinx.coroutines.withTimeoutOrNull

/** A single blocking initializer; timing out a waiter never waits for or restarts its work. */
internal class BlockingStartupTask(private val scope: CoroutineScope, private val initialize: () -> Unit) {
    private var task: Deferred<Result<Unit>>? = null

    @Synchronized
    fun start(): Deferred<Result<Unit>> {
        // The owner outlives UI waiters. Do not put initialize() inside their withTimeout block:
        // native database open/migration may ignore coroutine cancellation.
        return task ?: scope.async { runCatching(initialize) }.also { task = it }
    }

    suspend fun awaitReady(timeoutMs: Long): Boolean {
        require(timeoutMs > 0L)
        val current = start()
        val result = withTimeoutOrNull(timeoutMs) { current.await() } ?: return false
        if (result.isFailure) synchronized(this) { if (task === current) task = null }
        return result.isSuccess
    }
}
