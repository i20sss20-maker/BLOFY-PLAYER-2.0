package tv.blofy.player.core.update

import android.content.Context
import android.os.StatFs
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

/**
 * User-initiated APK download survives leaving the screen; installation always needs a tap.
 *
 * A stalled or dropped connection resumes from the bytes already saved (via HTTP Range) instead of
 * restarting from zero, and a transient failure is retried automatically a bounded number of times
 * before surfacing as a failure the user has to act on.
 */
class AppUpdateWorker(context: Context, parameters: WorkerParameters) : CoroutineWorker(context, parameters) {
    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        if (BuildConfig.IS_GOOGLE_PLAY) return@withContext Result.failure()
        val version = inputData.getInt(VERSION, 0)
        val url = inputData.getString(URL).orEmpty()
        val expectedSha = inputData.getString(SHA256)?.trim()?.lowercase()
        val expectedSize = inputData.getLong(APK_SIZE, 0L)
        if (version <= BuildConfig.VERSION_CODE || !safeUrl(url)) return@withContext Result.failure()
        if (BuildConfig.CODE_ONLY_LOGIN &&
            (expectedSha?.matches(Regex("[a-f0-9]{64}")) != true ||
             expectedSize !in 1..MAX_BYTES)) {
            return@withContext Result.failure(workDataOf(ERROR to "invalid_release"))
        }
        val target = file(applicationContext, version)
        // Keep the staging filename ending in .apk. Some Android TV/OEM PackageManager
        // implementations refuse to parse package archives whose path ends in ".apk.part".
        val partial = File(target.parentFile, "blofy-$version.download.apk")
        try {
            if (target.isFile &&
                (expectedSize <= 0 || target.length() == expectedSize) &&
                (!BuildConfig.CODE_ONLY_LOGIN ||
                    UpdatePackageVerifier.hasSha256(target, expectedSha)) &&
                UpdatePackageVerifier.verify(applicationContext, target, version))
                return@withContext Result.success()
            check(target.parentFile?.mkdirs() == true || target.parentFile?.isDirectory == true)
            if (expectedSize > 0L && partial.isFile && partial.length() > expectedSize) {
                partial.delete()
            }
            // The owner-signed FFmpeg STREAM APK exceeds 280 MB. Checking
            // free disk before download avoids wasting data on smaller TVs.
            if (expectedSize > 0) {
                val remaining = (expectedSize - partial.length()).coerceAtLeast(0L)
                val available = StatFs(target.parentFile!!.absolutePath).availableBytes
                if (available < remaining + 24L * 1024L * 1024L)
                    return@withContext Result.failure(workDataOf(ERROR to "insufficient_storage"))
            }
            val client = OkHttpClient.Builder().connectTimeout(15, TimeUnit.SECONDS)
                .readTimeout(45, TimeUnit.SECONDS).callTimeout(30, TimeUnit.MINUTES)
                .followSslRedirects(false).build()
            val resumeFrom = if (partial.isFile) partial.length() else 0L
            val request = Request.Builder().url(url).header("Accept-Encoding", "identity").apply {
                if (resumeFrom > 0) header("Range", "bytes=$resumeFrom-")
            }.build()
            client.newCall(request).execute().use { response ->
                if (!response.request.url.isHttps) throw IOException("download_failed")
                UpdateDownload.receive(response, partial, resumeFrom) { downloaded, total ->
                    setProgress(workDataOf(BYTES to downloaded, TOTAL to total))
                }
            }
            currentCoroutineContext().ensureActive()
            if ((expectedSize > 0L && partial.length() != expectedSize) ||
                (BuildConfig.CODE_ONLY_LOGIN &&
                    !UpdatePackageVerifier.hasSha256(partial, expectedSha)) ||
                !UpdatePackageVerifier.verify(applicationContext, partial, version)) {
                partial.delete()
                return@withContext Result.failure(workDataOf(ERROR to "invalid_package"))
            }
            if (target.exists() && !target.delete()) throw IOException("storage_failed")
            if (!partial.renameTo(target)) throw IOException("storage_failed")
            Result.success()
        } catch (cancelled: CancellationException) {
            // WorkManager may stop a worker because constraints changed. Preserve its prefix.
            throw cancelled
        } catch (nonResumable: UpdateDownload.RestartRequired) {
            partial.delete()
            if (runAttemptCount < MAX_AUTO_RETRIES) Result.retry() else Result.failure(workDataOf(ERROR to nonResumable.message))
        } catch (_: Exception) {
            if (runAttemptCount < MAX_AUTO_RETRIES) Result.retry() else Result.failure(workDataOf(ERROR to "download_failed"))
        }
    }

    companion object {
        const val VERSION = "version"
        const val URL = "url"
        const val BYTES = "bytes"
        const val TOTAL = "total"
        const val ERROR = "error"
        const val SHA256 = "sha256"
        const val APK_SIZE = "apk_size"
        // Includes the verified 55.8.11 FFmpeg APK (292,310,844 bytes), plus
        // future multi-ABI builds. Downloads are streamed, never RAM buffered.
        const val MAX_BYTES = 768L * 1024 * 1024
        const val MAX_AUTO_RETRIES = 5
        fun workName(version: Int) = "blofy-update-$version"
        fun file(context: Context, version: Int) = File(context.cacheDir, "updates/blofy-$version.apk")
        internal fun safeUrl(value: String): Boolean = runCatching {
            val uri = URI(value)
            uri.scheme.equals("https", true) && !uri.host.isNullOrBlank() && uri.userInfo == null
        }.getOrDefault(false)
    }
}
