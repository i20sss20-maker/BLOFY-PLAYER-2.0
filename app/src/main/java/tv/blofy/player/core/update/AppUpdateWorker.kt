package tv.blofy.player.core.update

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import tv.blofy.player.BuildConfig
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.net.URI
import java.util.concurrent.TimeUnit

/**
 * User-initiated APK download survives leaving the screen; installation always needs a tap.
 *
 * A stalled or dropped connection resumes from the bytes already saved (via HTTP Range) instead of
 * restarting from zero, and a transient failure is retried automatically a bounded number of times
 * before surfacing as a failure the user has to act on.
 */
class AppUpdateWorker(context: Context, parameters: WorkerParameters) : CoroutineWorker(context, parameters) {
    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        val version = inputData.getInt(VERSION, 0)
        val url = inputData.getString(URL).orEmpty()
        if (version <= BuildConfig.VERSION_CODE || !safeUrl(url)) return@withContext Result.failure()
        val target = file(applicationContext, version)
        val partial = File(target.parentFile, "${target.name}.part")
        try {
            if (target.isFile && UpdatePackageVerifier.verify(applicationContext, target, version)) return@withContext Result.success()
            check(target.parentFile?.mkdirs() == true || target.parentFile?.isDirectory == true)
            val client = OkHttpClient.Builder().connectTimeout(15, TimeUnit.SECONDS)
                .readTimeout(30, TimeUnit.SECONDS).callTimeout(8, TimeUnit.MINUTES)
                .followSslRedirects(false).build()
            val resumeFrom = if (partial.isFile) partial.length() else 0L
            val request = Request.Builder().url(url).apply {
                if (resumeFrom > 0) header("Range", "bytes=$resumeFrom-")
            }.build()
            client.newCall(request).execute().use { response ->
                if (!response.request.url.isHttps) throw IOException("download_failed")
                val resuming = resumeFrom > 0 && response.code == 206
                // The server ignored our Range request (or there was nothing to resume): start clean.
                if (!resuming && partial.isFile && !partial.delete()) throw IOException("storage_failed")
                if (!response.isSuccessful) throw IOException("download_failed")
                val body = response.body ?: throw IOException("empty_response")
                val startAt = if (resuming) resumeFrom else 0L
                val total = startAt + body.contentLength()
                if (total > MAX_BYTES || total <= 0L) throw NonResumableException("invalid_size")
                var downloaded = startAt
                var lastProgress = 0L
                body.byteStream().use { input -> FileOutputStream(partial, resuming).use { output ->
                    val buffer = ByteArray(64 * 1024)
                    while (true) {
                        currentCoroutineContext().ensureActive()
                        val count = input.read(buffer)
                        if (count < 0) break
                        downloaded += count
                        if (downloaded > MAX_BYTES) throw NonResumableException("invalid_size")
                        output.write(buffer, 0, count)
                        val now = android.os.SystemClock.elapsedRealtime()
                        if (now - lastProgress >= 500L) {
                            setProgress(workDataOf(BYTES to downloaded, TOTAL to total)); lastProgress = now
                        }
                    }
                    output.fd.sync()
                } }
                // Fewer bytes than promised almost always means the connection dropped mid-transfer;
                // keep the partial file so the next attempt can resume instead of starting over.
                if (downloaded == 0L || (total > 0 && total != downloaded)) throw IOException("incomplete_download")
            }
            currentCoroutineContext().ensureActive()
            if (!UpdatePackageVerifier.verify(applicationContext, partial, version)) {
                partial.delete()
                return@withContext Result.failure(workDataOf(ERROR to "invalid_package"))
            }
            if (target.exists() && !target.delete()) throw IOException("storage_failed")
            if (!partial.renameTo(target)) throw IOException("storage_failed")
            Result.success()
        } catch (cancelled: CancellationException) {
            // An explicit user cancel (or WorkManager tearing the worker down) should not leave a
            // resumable file behind pretending progress survived - "cancel" means start clean.
            partial.delete()
            throw cancelled
        } catch (nonResumable: NonResumableException) {
            partial.delete()
            if (runAttemptCount < MAX_AUTO_RETRIES) Result.retry() else Result.failure(workDataOf(ERROR to nonResumable.message))
        } catch (_: Exception) {
            // Network hiccups (timeouts, connection resets, a Wi-Fi drop) land here. The partial file
            // is left in place on purpose so the retry - automatic or the user's manual tap - resumes.
            if (runAttemptCount < MAX_AUTO_RETRIES) Result.retry() else Result.failure(workDataOf(ERROR to "download_failed"))
        }
    }

    private class NonResumableException(message: String) : IOException(message)

    companion object {
        const val VERSION = "version"
        const val URL = "url"
        const val BYTES = "bytes"
        const val TOTAL = "total"
        const val ERROR = "error"
        const val MAX_BYTES = 256L * 1024 * 1024
        const val MAX_AUTO_RETRIES = 5
        fun workName(version: Int) = "blofy-update-$version"
        fun file(context: Context, version: Int) = File(context.cacheDir, "updates/blofy-$version.apk")
        internal fun safeUrl(value: String): Boolean = runCatching {
            val uri = URI(value)
            uri.scheme.equals("https", true) && !uri.host.isNullOrBlank() && uri.userInfo == null
        }.getOrDefault(false)
    }
}
