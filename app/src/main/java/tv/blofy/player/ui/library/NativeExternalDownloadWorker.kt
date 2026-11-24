package tv.blofy.player.ui.library

import android.app.DownloadManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.content.pm.ServiceInfo
import android.net.Uri
import android.os.Build
import androidx.work.CoroutineWorker
import androidx.work.ForegroundInfo
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.withContext
import okhttp3.Request
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import tv.blofy.player.core.identity.NativeExternalCatalogSession
import tv.blofy.player.core.identity.NativeExternalMediaTransport
import tv.blofy.player.core.identity.ExternalStreamConnectStore
import java.io.File
import java.io.IOException
import java.util.UUID

/** User-confirmed progressive downloads only. Never give Xtream secrets to
 * Android DownloadManager, notification text, saved work input or disk URLs. */
class NativeExternalDownloadWorker(context: Context, params: WorkerParameters) :
    CoroutineWorker(context,params) {
    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        val provider = inputData.getString("provider").orEmpty()
        val route = inputData.getString("route").orEmpty()
        val extension = inputData.getString("extension").orEmpty()
        val kind = inputData.getString("kind").orEmpty()
        val app = applicationContext
        if (!NativeExternalCatalogSession.qaEnabled(app) ||
            !OfflineDownloadPolicy.supported(kind,route,extension) ||
            !NativeExternalDownloadQueue.validRoute(provider,kind,route,extension))
            return@withContext failure(DownloadManager.ERROR_UNHANDLED_HTTP_CODE)
        if (NativeExternalCatalogSession.activeId(app) != provider)
            return@withContext failure(DownloadManager.ERROR_UNKNOWN)
        val profile = ExternalStreamConnectStore.loadStaged(app)
        if (profile?.providerId != provider || profile.credentials.host.scheme != "https")
            return@withContext failure(DownloadManager.ERROR_UNHANDLED_HTTP_CODE)

        val file = NativeExternalDownloadQueue.file(app,id,extension)
        val partial = File(file.parentFile,file.name + ".part")
        val validator = File(file.parentFile,file.name + ".etag")
        var preservePartial = false
        var retrying = false
        if (file.isFile && file.length() > 0L) return@withContext Result.success()
        try {
            check(file.parentFile?.isDirectory == true || file.parentFile?.mkdirs() == true)
            setForeground(foreground())
            val previousTag = if (validator.isFile && validator.length() in 1L..256L)
                NativeDownloadResumePolicy.strongTag(validator.readText()) else null
            val requestedOffset = if (previousTag != null && partial.isFile) partial.length() else 0L
            val request = Request.Builder().url(route).header("Accept-Encoding","identity").apply {
                if (requestedOffset > 0) {
                    header("Range","bytes=$requestedOffset-")
                    header("If-Range",checkNotNull(previousTag))
                }
            }.build()
            val call = NativeExternalMediaTransport.client(app,provider).newCall(request)
            call.execute().use { response ->
                if (response.code !in setOf(200,206)) {
                    if ((response.code == 416 && requestedOffset > 0L) || response.code in 500..599)
                        throw IOException("Download response retry")
                    return@withContext failure(DownloadManager.ERROR_UNHANDLED_HTTP_CODE)
                }
                if (response.header("Content-Encoding")?.equals("identity",true) == false)
                    return@withContext failure(DownloadManager.ERROR_UNHANDLED_HTTP_CODE)
                val body = response.body ?: return@withContext failure(DownloadManager.ERROR_HTTP_DATA_ERROR)
                val mime = body.contentType()
                if (mime == null || (mime.type != "video" && mime.toString().substringBefore(';') !in
                        setOf("application/octet-stream","application/x-matroska")))
                    return@withContext failure(DownloadManager.ERROR_UNHANDLED_HTTP_CODE)
                val plan = NativeDownloadResumePolicy.plan(response.code,requestedOffset,previousTag,
                    response.header("ETag"),response.header("Content-Range"),body.contentLength())
                    ?: throw IOException("Invalid download range")
                if (!DownloadTransferPolicy.enoughSpace(file.parentFile!!.usableSpace,plan.total-plan.offset))
                    return@withContext failure(DownloadManager.ERROR_INSUFFICIENT_SPACE)
                if (plan.offset == 0L) {
                    validator.delete()
                    partial.delete()
                    if (plan.tag != null) validator.writeText(plan.tag)
                }
                val total = plan.total
                preservePartial = plan.tag != null
                var done = plan.offset
                var last = 0L
                body.byteStream().use { source ->
                    java.io.FileOutputStream(partial,plan.offset > 0L).buffered().use { sink ->
                        val buffer = ByteArray(64*1024)
                        while (true) {
                            currentCoroutineContext().ensureActive()
                            val n = source.read(buffer)
                            if (n < 0) break
                            done += n
                            if (done > total) { preservePartial = false; throw IOException("Unexpected download size") }
                            if (file.parentFile!!.usableSpace < 268_435_456L)
                                return@withContext failure(DownloadManager.ERROR_INSUFFICIENT_SPACE)
                            sink.write(buffer,0,n)
                            val now = android.os.SystemClock.elapsedRealtime()
                            if (now-last >= 1000L) {
                                setProgress(workDataOf("done" to done,"total" to total))
                                last = now
                            }
                        }
                    }
                }
                if (done != total || partial.length() != total ||
                    NativeExternalCatalogSession.activeId(app) != provider)
                    return@withContext failure(DownloadManager.ERROR_HTTP_DATA_ERROR)
                currentCoroutineContext().ensureActive()
                check(OfflineDownloadStore.records(app,provider).any { it.workerId == id.toString() })
                check(OfflineDownloadStore.publishNativeFile(app,provider,id,partial,file))
                preservePartial = false
                setProgress(workDataOf("done" to total,"total" to total))
                Result.success()
            }
        } catch (cancelled: CancellationException) {
            retrying = true
            preservePartial = preservePartial && OfflineDownloadStore.records(app,provider).any { it.workerId == id.toString() }
            throw cancelled
        } catch (_: IOException) {
            if (runAttemptCount < 2) { retrying = true; Result.retry() } else {
                preservePartial = false
                failure(DownloadManager.ERROR_HTTP_DATA_ERROR)
            }
        } catch (_: Exception) {
            preservePartial = false
            failure(DownloadManager.ERROR_FILE_ERROR)
        } finally {
            if (!retrying || !preservePartial || !OfflineDownloadStore.records(app,provider).any { it.workerId == id.toString() }) {
                partial.delete()
                validator.delete()
            }
        }
    }

    private fun failure(reason: Int) = Result.failure(workDataOf("reason" to reason))

    private fun foreground(): ForegroundInfo {
        val app = applicationContext
        val channel = "blofy_external_downloads"
        val manager = app.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (Build.VERSION.SDK_INT >= 26)
            manager.createNotificationChannel(NotificationChannel(channel,"BLOFY downloads",NotificationManager.IMPORTANCE_LOW))
        val builder = if (Build.VERSION.SDK_INT >= 26) Notification.Builder(app,channel)
            else Notification.Builder(app)
        val notification = builder.setSmallIcon(android.R.drawable.stat_sys_download)
            .setContentTitle("BLOFY STREAM").setContentText("Downloading requested video")
            .setOngoing(true).build()
        val notificationId = (id.hashCode() and 0x3fffffff) + 1
        return if (Build.VERSION.SDK_INT >= 29)
            ForegroundInfo(notificationId,notification,ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
        else ForegroundInfo(notificationId,notification)
    }
}

internal object NativeExternalDownloadQueue {
    fun validRoute(provider: String, kind: String, route: String, extension: String): Boolean {
        if (!NativeExternalMediaTransport.isExternal(provider) || kind !in setOf("movie","episode") ||
            extension !in OfflineDownloadPolicy.progressiveFormats) return false
        val uri = route.toHttpUrlOrNull() ?: return false
        val parts = uri.pathSegments
        if (parts.size != 4 || parts[0] != "native" || parts[1] != provider ||
            parts[2] != (if (kind == "episode") "series" else "movie")) return false
        val remote = parts[3].substringBeforeLast('.')
        return runCatching {
            NativeExternalMediaTransport.route(provider,parts[2],remote,extension) == route
        }.getOrDefault(false)
    }

    fun isReadyFile(context: Context,provider: String,contentKey: String,uri: Uri): Boolean {
        if (!NativeExternalCatalogSession.qaEnabled(context) ||
            tv.blofy.player.core.identity.StreamCodeSession.isClaimed(context) ||
            ExternalStreamConnectStore.loadStaged(context)?.providerId != provider) return false
        val record = OfflineDownloadStore.find(context,contentKey) ?: return false
        if (record.providerId != provider || record.workerId == null || uri.scheme != "file") return false
        return runCatching {
            val file = file(context,UUID.fromString(record.workerId),record.extension)
            file.isFile && file.length()>0 && Uri.fromFile(file) == uri
        }.getOrDefault(false)
    }

    fun file(context: Context,id: UUID,extension: String): File {
        require(extension in OfflineDownloadPolicy.progressiveFormats)
        val directory = checkNotNull(context.getExternalFilesDir(android.os.Environment.DIRECTORY_MOVIES))
        return File(directory,"BLOFY-native-$id.$extension")
    }
}
