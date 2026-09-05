package tv.blofy.player.data.preparation

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive

/** A child timeout is recoverable; Back/destroy/parent cancellation must still propagate. */
internal object CatalogLoadAttempt {
    suspend fun run(
        onTimeout: () -> Unit,
        onFailure: (Exception) -> Unit,
        block: suspend () -> Unit,
    ) {
        try {
            block()
        } catch (timeout: TimeoutCancellationException) {
            currentCoroutineContext().ensureActive()
            onTimeout()
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (error: Exception) {
            currentCoroutineContext().ensureActive()
            onFailure(error)
        }
    }
}
