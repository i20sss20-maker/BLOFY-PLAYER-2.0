package tv.blofy.player.ui.home

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.launch

/** One visible-Home observer, including writes that finish after returning from details. */
internal class HomeHistoryObserver(
    private val scope: CoroutineScope,
    private val changes: () -> Flow<*>,
    private val refresh: suspend () -> Unit,
) {
    private var job: Job? = null

    fun start() {
        if (job?.isActive == true) return
        job = scope.launch {
            changes().collectLatest {
                try {
                    refresh()
                } catch (cancelled: CancellationException) {
                    throw cancelled
                } catch (_: Exception) {
                    // Keep the last visible shelves if an optional history read fails.
                }
            }
        }
    }

    fun stop() {
        job?.cancel()
        job = null
    }
}
