package tv.blofy.player.ui.library

import android.app.AlertDialog
import android.net.Uri
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import tv.blofy.player.R

/** Deliberate subscriber opt-in, never auto-downloads from watch history. */
internal object OfflineDownloadUi {
    data class Plan(
        val providerId: String,
        val contentKey: String,
        val kind: String,
        val title: String,
        val url: String,
        val extension: String,
    )

    fun show(activity: AppCompatActivity, requests: List<Plan>) {
        if (requests.isEmpty()) {
            Toast.makeText(activity,R.string.stream_downloads_unavailable,Toast.LENGTH_LONG).show()
            return
        }
        val allowed = requests.distinctBy(Plan::contentKey).filter { plan ->
            OfflineDownloadPolicy.supported(plan.kind,plan.url,plan.extension)
        }.take(20)
        if (allowed.isEmpty()) {
            AlertDialog.Builder(activity)
                .setTitle(R.string.stream_downloads_unavailable_title)
                .setMessage(R.string.stream_downloads_unavailable)
                .setPositiveButton(android.R.string.ok,null).show()
            return
        }
        // A HEAD probe only reads response headers: it does not download media
        // or trust that a playback URL gives the subscriber download rights.
        activity.lifecycleScope.launch {
            val size = if (allowed.size == 1)
                DownloadFileProbe.sizeIfKnown(activity.applicationContext, allowed.first().url)
            else null
            val remaining = withContext(Dispatchers.IO) {
                activity.getExternalFilesDir(android.os.Environment.DIRECTORY_MOVIES)?.usableSpace ?: -1L
            }
            if (activity.isFinishing || activity.isDestroyed) return@launch
            if (size != null && !DownloadTransferPolicy.enoughSpace(remaining, size)) {
                AlertDialog.Builder(activity)
                    .setTitle(R.string.stream_downloads_failure_title)
                    .setMessage(activity.getString(
                        R.string.stream_downloads_not_enough_space_estimated,
                        OfflineDownloadStore.formatSize(size),
                        OfflineDownloadStore.formatSize(remaining)
                    ))
                    .setPositiveButton(R.string.stream_downloads_storage_settings) { _, _ ->
                        runCatching {
                            activity.startActivity(android.content.Intent(
                                android.provider.Settings.ACTION_INTERNAL_STORAGE_SETTINGS))
                        }
                    }
                    .setNegativeButton(android.R.string.cancel, null)
                    .show()
                return@launch
            }
            if (remaining in 0L until 536_870_912L && size == null) {
                AlertDialog.Builder(activity)
                    .setTitle(R.string.stream_downloads_failure_title)
                    .setMessage(activity.getString(
                        R.string.stream_downloads_low_space_confirm,
                        OfflineDownloadStore.formatSize(remaining)
                    ))
                    .setPositiveButton(R.string.stream_downloads_continue_anyway) { _, _ ->
                        confirmDownloads(activity, allowed, null)
                    }
                    .setNegativeButton(android.R.string.cancel, null).show()
                return@launch
            }
            confirmDownloads(activity, allowed, size)
        }
    }

    private fun confirmDownloads(activity: AppCompatActivity, allowed: List<Plan>, estimatedBytes: Long?) {
        AlertDialog.Builder(activity)
            .setTitle(activity.getString(R.string.stream_downloads_confirm_title,allowed.size))
            .setMessage(activity.getString(R.string.stream_downloads_consent) +
                (estimatedBytes?.let {
                    "\\n\\n" + activity.getString(R.string.stream_downloads_estimated_size,
                        OfflineDownloadStore.formatSize(it))
                } ?: ""))
            .setPositiveButton(R.string.stream_downloads_confirm) { _, _ ->
                activity.lifecycleScope.launch {
                    val outcome=withContext(Dispatchers.IO) {
                        var queued=0
                        var errors=0
                        allowed.forEach { plan ->
                            OfflineDownloadStore.enqueue(
                                activity.applicationContext,plan.providerId,plan.contentKey,
                                plan.kind,plan.title,plan.url,plan.extension
                            ).fold(onSuccess={queued++},onFailure={errors++})
                        }
                        queued to errors
                    }
                    if(!activity.isFinishing && !activity.isDestroyed) {
                        Toast.makeText(activity,
                            activity.getString(R.string.stream_downloads_queued,outcome.first,outcome.second),
                            Toast.LENGTH_LONG).show()
                    }
                }
            }
            .setNegativeButton(android.R.string.cancel,null)
            .show()
    }

    fun plan(
        providerId: String, contentKey: String, kind: String, title: String, url: String,
        extension: String?
    ): Plan {
        val fromUrl = Uri.parse(url).lastPathSegment.orEmpty()
            .substringAfterLast('.', "").substringBefore('?')
        val ext = OfflineDownloadPolicy.extension(extension).ifBlank {
            OfflineDownloadPolicy.extension(fromUrl)
        }
        return Plan(providerId,contentKey,kind,title,url,ext)
    }
}
