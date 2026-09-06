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
        // Keep progress aligned with the actual local work. Historically the screen could sit at
        // 70% while Home preparation was still finishing, which looked frozen even though it was
        // working. The heavy local step now advances past that point only when it is actually done.
        progress(34)
        home()
        currentCoroutineContext().ensureActive()
        progress(84)
        search()
        currentCoroutineContext().ensureActive()
        progress(96)
        commit()
        currentCoroutineContext().ensureActive()
        progress(100)
    }
}
