package tv.blofy.player.data.preparation

import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive

/** The entry barrier has local steps only; optional network enrichment is not a dependency. */
internal object EntryPreparationPipeline {
    suspend fun run(
        home: suspend () -> Unit,
        search: suspend () -> Unit,
        commit: suspend () -> Unit,
        progress: suspend (Int) -> Unit,
    ) {
        currentCoroutineContext().ensureActive()
        progress(32)
        home()
        currentCoroutineContext().ensureActive()
        progress(70)
        search()
        currentCoroutineContext().ensureActive()
        progress(95)
        commit()
        currentCoroutineContext().ensureActive()
        progress(100)
    }
}
