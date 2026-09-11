package tv.blofy.player.data.remote

import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import okhttp3.ResponseBody
import retrofit2.Call
import retrofit2.Callback
import retrofit2.HttpException
import retrofit2.Response
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

/** Retrofit's suspended @Streaming request ends at the headers, before the blocking body read.
 * Keep ownership of the call until parsing/Room batches finish so Back or a deadline closes the
 * old socket immediately, including after a Wi-Fi change. Playback clients are unrelated.
 */
internal suspend fun <T> Call<ResponseBody>.readCatalog(block: suspend (ResponseBody) -> T): T = coroutineScope {
    val request = this@readCatalog
    val cancellation = launch(Dispatchers.IO, start = CoroutineStart.UNDISPATCHED) {
        try { awaitCancellation() } finally { request.cancel() }
    }
    try { request.awaitBody().use { block(it) } }
    catch (failure: Exception) { currentCoroutineContext().ensureActive(); throw failure }
    finally { cancellation.cancel(); request.cancel() }
}

@OptIn(ExperimentalCoroutinesApi::class)
private suspend fun Call<ResponseBody>.awaitBody(): ResponseBody = suspendCancellableCoroutine { continuation ->
    continuation.invokeOnCancellation { cancel() }
    enqueue(object : Callback<ResponseBody> {
        override fun onFailure(call: Call<ResponseBody>, failure: Throwable) {
            if (continuation.isActive) continuation.resumeWithException(failure)
        }
        override fun onResponse(call: Call<ResponseBody>, response: Response<ResponseBody>) {
            val body = response.body()
            if (!continuation.isActive) {
                body?.close(); response.errorBody()?.close()
            } else if (!response.isSuccessful || body == null) {
                response.errorBody()?.close()
                continuation.resumeWithException(HttpException(response))
            } else continuation.resume(body) { body.close() }
        }
    })
}
