package tv.blofy.player.ui.library

import android.app.DownloadManager
import android.content.Context
import android.net.Uri
import android.os.Environment
import org.json.JSONObject
import tv.blofy.player.BuildConfig
import tv.blofy.player.core.identity.StreamCodeSession
import java.security.MessageDigest
import java.util.UUID
import androidx.work.*
import java.util.concurrent.TimeUnit
import tv.blofy.player.core.identity.NativeExternalCatalogSession
import tv.blofy.player.core.identity.NativeExternalMediaTransport

/**
 * Persistent user-requested transfers managed by Android DownloadManager.
 *
 * Stores only IDs, provider-scoped content keys and display labels locally.
 * Streaming URLs, Xtream passwords and bearer tokens are NOT stored in this
 * app's preferences. System DownloadManager owns request headers/URIs.
 * Downloads live in this app's external-files movie directory, not public
 * gallery storage; no dangerous storage permission is requested.
 */
internal object OfflineDownloadStore {
    private const val PREFS = "blofy_offline_downloads_v1"
    private const val PREFIX = "d_"
    private const val MAX_RECORDS = 140
    private const val TRUSTED_STREAM_HOST = "blofyplayer.com"
    const val STATUS_MISSING = -2

    data class Record(
        val contentKey: String,
        val providerId: String,
        val kind: String,
        val title: String,
        val id: Long,
        val extension: String,
        val createdAt: Long,
        val workerId: String? = null,
    )
    data class Progress(
        val record: Record,
        val status: Int,
        val downloaded: Long,
        val total: Long,
        val reason: Int,
        val readyUri: Uri?
    ) {
        val percent: Int? get() = DownloadTransferPolicy.percent(downloaded, total)
    }

    private fun manager(context: Context) =
        context.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
    private fun prefs(context: Context) = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    private fun hash(source: String): String = MessageDigest.getInstance("SHA-256")
        .digest(source.toByteArray(Charsets.UTF_8))
        .take(14).joinToString("") { "%02x".format(it.toInt() and 0xff) }

    private fun storageKey(contentKey: String) = PREFIX + hash(contentKey)

    private fun parse(raw: String?): Record? {
        if (raw.isNullOrBlank()) return null
        return runCatching {
            val o = JSONObject(raw)
            Record(
                o.getString("key"), o.getString("provider"), o.getString("kind"),
                o.getString("title"), o.getLong("id"), o.getString("extension"),
                o.getLong("created"), o.optString("workerId").takeIf { it.isNotBlank() }
            )
        }.getOrNull()?.takeIf {
            it.contentKey.isNotBlank() && it.providerId.isNotBlank() &&
                it.kind in setOf("movie", "episode") && it.id > 0
        }
    }

    @Synchronized
    fun records(context: Context, providerId: String? = null): List<Record> =
        prefs(context).all.asSequence()
            .filter { it.key.startsWith(PREFIX) }
            .mapNotNull { parse(it.value as? String) }
            .filter { providerId == null || it.providerId == providerId }
            .sortedByDescending(Record::createdAt)
            .take(MAX_RECORDS).toList()

    @Synchronized
    fun find(context: Context, key: String): Record? =
        parse(prefs(context).getString(storageKey(key), null))?.takeIf { it.contentKey == key }

    /**
     * Must be called only after an explicit permission-to-download dialog.
     * Uses the already-resolved provider URL, never assembles new Xtream paths.
     * A stale/failed prior request is removed before retrying.
     */
    @Synchronized
    fun enqueue(
        context: Context, providerId: String, contentKey: String,
        kind: String, title: String, url: String, extension: String
    ): Result<Record> = runCatching {
        require(providerId.isNotBlank() && contentKey.isNotBlank())
        require(title.isNotBlank() && extension.isNotBlank())
        require(OfflineDownloadPolicy.supported(kind,url,extension)) {
            "Only authorized HTTPS direct MP4/MKV/WEBM/MOV/M4V video can be downloaded"
        }
        val dm = manager(context)
        val existing = find(context,contentKey)
        if(existing != null) {
            val current = progress(context,existing)
            if (current?.status !in setOf(null, STATUS_MISSING, DownloadManager.STATUS_FAILED)) return@runCatching existing
            remove(context,existing)
        }
        check(records(context).size < MAX_RECORDS) { "Download list is full; remove old entries first" }
        if (NativeExternalMediaTransport.isExternal(providerId)) {
            check(NativeExternalCatalogSession.qaEnabled(context) &&
                NativeExternalDownloadQueue.validRoute(providerId,kind,url,extension))
            val work = OneTimeWorkRequestBuilder<NativeExternalDownloadWorker>()
                .setInputData(workDataOf("provider" to providerId,"kind" to kind,"route" to url,"extension" to extension))
                .setConstraints(Constraints.Builder().setRequiredNetworkType(
                    if (OfflineDownloadSettings.wifiOnly(context)) NetworkType.UNMETERED else NetworkType.CONNECTED).build())
                .build()
            val record = Record(contentKey,providerId,kind,title.take(130),
                (work.id.mostSignificantBits and Long.MAX_VALUE).coerceAtLeast(1L),extension,
                System.currentTimeMillis(),work.id.toString())
            save(context,record)
            try {
                WorkManager.getInstance(context.applicationContext).enqueue(work).result.get(10,TimeUnit.SECONDS)
            } catch (error: Exception) {
                WorkManager.getInstance(context.applicationContext).cancelWorkById(work.id)
                prefs(context).edit().remove(storageKey(contentKey)).commit()
                throw error
            }
            return@runCatching record
        }
        check(!hostIsNative(url)) { "External download route unavailable" }
        val host = Uri.parse(url).host.orEmpty()
        val request = DownloadManager.Request(Uri.parse(url))
            .setTitle(title.take(85))
            .setDescription("BLOFY • user-requested offline video")
            .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
            .setAllowedOverRoaming(false)
            .setAllowedOverMetered(!OfflineDownloadSettings.wifiOnly(context))
            .setMimeType(when(extension.lowercase()) {
                "mkv" -> "video/x-matroska"
                "webm" -> "video/webm"
                "mov" -> "video/quicktime"
                else -> "video/mp4"
            })
            .setDestinationInExternalFilesDir(
                context, Environment.DIRECTORY_MOVIES,
                "BLOFY-" + hash(providerId + ":" + contentKey) + "." + extension.lowercase()
            )
        // STREAM media endpoints validate the same encrypted session as the
        // player. Only attach that bearer to our exact HTTPS first-party host.
        if (BuildConfig.CODE_ONLY_LOGIN &&
            host.equals(TRUSTED_STREAM_HOST, ignoreCase = true) &&
            Uri.parse(url).path.orEmpty().startsWith("/api/v1/stream/media/")) {
            val auth = StreamCodeSession.authorization(context)
                ?: throw IllegalStateException("BLOFY activation is required")
            request.addRequestHeader("Authorization", auth)
        }
        val id = dm.enqueue(request)
        val record = Record(contentKey, providerId,kind,title.take(130),id,extension.lowercase(),System.currentTimeMillis())
        try { save(context,record) }
        catch (error: Exception) { dm.remove(id); throw error }
        record
    }

    private fun hostIsNative(url: String) = Uri.parse(url).host.equals("external-xtream.invalid",true)

    private fun save(context: Context,record: Record) {
        val payload = JSONObject().apply {
            put("key",record.contentKey);put("provider",record.providerId)
            put("kind",record.kind);put("title",record.title)
            put("id",record.id);put("extension",record.extension);put("created",record.createdAt)
            record.workerId?.let { put("workerId",it) }
        }.toString()
        check(prefs(context).edit().putString(storageKey(record.contentKey),payload).commit()) {
            "Unable to save download status"
        }
    }

    fun progress(context: Context, record: Record): Progress? {
        record.workerId?.let { raw ->
            return runCatching {
                val id = UUID.fromString(raw)
                val file = NativeExternalDownloadQueue.file(context,id,record.extension)
                if (file.isFile && file.length()>0L)
                    return@runCatching Progress(record,DownloadManager.STATUS_SUCCESSFUL,file.length(),file.length(),0,Uri.fromFile(file))
                val info = WorkManager.getInstance(context.applicationContext).getWorkInfoById(id).get(2,TimeUnit.SECONDS)
                    ?: return@runCatching null
                val status = when(info.state) {
                    WorkInfo.State.RUNNING -> DownloadManager.STATUS_RUNNING
                    WorkInfo.State.ENQUEUED, WorkInfo.State.BLOCKED -> DownloadManager.STATUS_PENDING
                    WorkInfo.State.FAILED, WorkInfo.State.CANCELLED -> DownloadManager.STATUS_FAILED
                    else -> STATUS_MISSING
                }
                Progress(record,status,info.progress.getLong("done",0),info.progress.getLong("total",-1),
                    info.outputData.getInt("reason",DownloadManager.ERROR_UNKNOWN),null)
            }.getOrNull()
        }
        val dm = manager(context)
        dm.query(DownloadManager.Query().setFilterById(record.id))?.use { cursor ->
            if (!cursor.moveToFirst()) return null
            fun num(name:String) = cursor.getLong(cursor.getColumnIndexOrThrow(name))
            val status = num(DownloadManager.COLUMN_STATUS).toInt()
            val total = num(DownloadManager.COLUMN_TOTAL_SIZE_BYTES)
            val done = num(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR)
            val reason = num(DownloadManager.COLUMN_REASON).toInt()
            val uri = if (status == DownloadManager.STATUS_SUCCESSFUL)
                runCatching { dm.getUriForDownloadedFile(record.id) }.getOrNull()
            else null
            // A stale or deleted file is not a valid completed download.
            val actualStatus = if (status == DownloadManager.STATUS_SUCCESSFUL &&
                !DownloadTransferPolicy.isValidDownloadedFile(status, done, uri != null, total))
                STATUS_MISSING else status
            return Progress(record,actualStatus,done,total,reason,uri)
        }
        return null
    }

    // Serialize the final atomic rename with cancellation/removal so a removed
    // transfer cannot reappear as an orphan file.
    @Synchronized
    fun publishNativeFile(context: Context,providerId: String,id: UUID,partial: java.io.File,destination: java.io.File): Boolean {
        if (!records(context,providerId).any { it.workerId == id.toString() }) return false
        return partial.renameTo(destination)
    }

    @Synchronized
    fun remove(context: Context, record: Record) {
        if (record.workerId != null) {
            val id = UUID.fromString(record.workerId)
            WorkManager.getInstance(context.applicationContext).cancelWorkById(id)
            val file = NativeExternalDownloadQueue.file(context,id,record.extension)
            file.delete()
            java.io.File(file.parentFile,file.name+".part").delete()
            java.io.File(file.parentFile,file.name+".etag").delete()
        } else manager(context).remove(record.id)
        prefs(context).edit().remove(storageKey(record.contentKey)).apply()
    }

    @Synchronized fun removeNativeProvider(context: Context,providerId: String) {
        records(context,providerId).filter { it.workerId != null }.forEach { remove(context,it) }
    }

    fun formatSize(bytes: Long): String = when {
        bytes < 0 -> "—"
        bytes < 1_048_576 -> "${(bytes/1024L).coerceAtLeast(0)} KB"
        bytes < 1_073_741_824L -> String.format(java.util.Locale.US,"%.1f MB",bytes.toDouble()/1_048_576)
        else -> String.format(java.util.Locale.US,"%.2f GB",bytes.toDouble()/1_073_741_824)
    }
}
