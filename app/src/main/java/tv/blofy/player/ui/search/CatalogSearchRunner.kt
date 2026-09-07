package tv.blofy.player.ui.search

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/** Debouncing and the Room query share one job so a new request cancels both. */
internal class CatalogSearchRunner(
    private val scope: CoroutineScope,
    private val search: suspend (query: String, moveFocus: Boolean) -> Unit,
) {
    private var job: Job? = null

    fun submit(query: String, moveFocus: Boolean) {
        cancel()
        val cleanQuery = query.trim()
        if (cleanQuery.isEmpty()) return
        job = scope.launch {
            if (!moveFocus) delay(110)
            search(cleanQuery, moveFocus)
        }
    }

    fun cancel() {
        job?.cancel()
        job = null
    }
}
