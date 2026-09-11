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
import java.io.IOException
import java.net.URI
import java.util.concurrent.TimeUnit

/** User-initiated APK download survives leaving the screen; installation always needs a tap. */
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
            client.newCall(Request.Builder().url(url).build()).execute().use { response ->
                if (!response.isSuccessful || !response.request.url.isHttps) throw IOException("download_failed")
                val body = response.body ?: throw IOException("empty_response")
                val total = body.contentLength()
                if (total > MAX_BYTES || total == 0L) throw IOException("invalid_size")
                var downloaded = 0L
                var lastProgress = 0L
                body.byteStream().use { input -> partial.outputStream().use { output ->
                    val buffer = ByteArray(64 * 1024)
                    while (true) {
                        currentCoroutineContext().ensureActive()
                        val count = input.read(buffer)
                        if (count < 0) break
                        downloaded += count
                        if (downloaded > MAX_BYTES) throw IOException("invalid_size")
                        output.write(buffer, 0, count)
                        val now = android.os.SystemClock.elapsedRealtime()
                        if (now - lastProgress >= 500L) {
                            setProgress(workDataOf(BYTES to downloaded, TOTAL to total)); lastProgress = now
                        }
                    }
                    output.fd.sync()
                } }
                if (downloaded == 0L || (total > 0 && total != downloaded)) throw IOException("incomplete_download")
            }
            currentCoroutineContext().ensureActive()
            if (!UpdatePackageVerifier.verify(applicationContext, partial, version)) {
                return@withContext Result.failure(workDataOf(ERROR to "invalid_package"))
            }
            if (target.exists() && !target.delete()) throw IOException("storage_failed")
            if (!partial.renameTo(target)) throw IOException("storage_failed")
            Result.success()
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (_: Exception) {
            Result.failure(workDataOf(ERROR to "download_failed"))
        } finally {
            partial.delete()
        }
    }

    companion object {
        const val VERSION = "version"
        const val URL = "url"
        const val BYTES = "bytes"
        const val TOTAL = "total"
        const val ERROR = "error"
        const val MAX_BYTES = 256L * 1024 * 1024
        fun workName(version: Int) = "blofy-update-$version"
        fun file(context: Context, version: Int) = File(context.cacheDir, "updates/blofy-$version.apk")
        internal fun safeUrl(value: String): Boolean = runCatching {
            val uri = URI(value)
            uri.scheme.equals("https", true) && !uri.host.isNullOrBlank() && uri.userInfo == null
        }.getOrDefault(false)
    }
}
