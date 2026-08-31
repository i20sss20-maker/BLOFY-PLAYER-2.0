package tv.blofy.player.data

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.launch

data class ResumeWriteRequest(
    val contentKey: String,
    val providerId: String,
    val kind: String,
    val positionMs: Long,
    val durationMs: Long
)

/**
 * Serializes resume writes on an owner scope that outlives the playback Activity.
 * The Activity captures the player values before release, then only queues this snapshot.
 */
class ResumeStateWriter(
    ownerScope: CoroutineScope,
    private val persist: suspend (ResumeWriteRequest) -> Unit
) {
    private val pending = Channel<ResumeWriteRequest>(Channel.UNLIMITED)

    init {
        ownerScope.launch {
            for (request in pending) {
                try {
                    persist(request)
                } catch (cancelled: CancellationException) {
                    throw cancelled
                } catch (_: Exception) {
                    // A single database failure must not terminate later resume writes.
                }
            }
        }
    }

    fun enqueue(request: ResumeWriteRequest): Boolean {
        val validRequest = request.takeIf {
            it.kind != LIVE_KIND && it.contentKey.isNotBlank() && it.providerId.isNotBlank()
        } ?: return false

        return pending.trySend(
            validRequest.copy(
                positionMs = validRequest.positionMs.coerceAtLeast(0L),
                durationMs = validRequest.durationMs.coerceAtLeast(0L)
            )
        ).isSuccess
    }

    private companion object {
        const val LIVE_KIND = "live"
    }
}
