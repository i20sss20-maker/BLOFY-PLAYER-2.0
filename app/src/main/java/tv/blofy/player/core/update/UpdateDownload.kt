package tv.blofy.player.core.update

import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import okhttp3.Response
import java.io.File
import java.io.FileOutputStream
import java.io.IOException

/** Copies one HTTP response; the caller still verifies the APK identity and signing certificate. */
internal object UpdateDownload {
    class RestartRequired(message: String) : IOException(message)

    suspend fun receive(
        response: Response,
        partial: File,
        resumeFrom: Long,
        maxBytes: Long = AppUpdateWorker.MAX_BYTES,
        progress: suspend (downloaded: Long, total: Long) -> Unit = { _, _ -> }
    ) {
        // A transient HTTP failure says nothing about the already saved prefix. Keep it.
        if (response.code == 416) throw RestartRequired("invalid_range")
        if (!response.isSuccessful) throw IOException("download_failed")
        if (response.code != 200 && response.code != 206) throw RestartRequired("invalid_response")
        val body = response.body ?: throw IOException("empty_response")
        val length = body.contentLength()
        val range = if (response.code == 206) parseRange(response.header("Content-Range")) else null
        if (response.code == 206 && (range == null || range.start != resumeFrom ||
                (partial.takeIf(File::isFile)?.length() ?: 0L) != resumeFrom)) {
            throw RestartRequired("invalid_range")
        }
        val startAt = range?.start ?: 0L
        val expectedBody = range?.let { it.end - it.start + 1 } ?: length
        val total = range?.total ?: length
        if (startAt < 0 || startAt >= maxBytes || total > maxBytes || total == 0L ||
            expectedBody > maxBytes - startAt || (range != null && length >= 0 && length != expectedBody)) {
            throw RestartRequired("invalid_size")
        }
        var downloaded = startAt
        var lastProgress = 0L
        body.byteStream().use { input -> FileOutputStream(partial, range != null && startAt > 0L).use { output ->
            val buffer = ByteArray(64 * 1024)
            while (true) {
                currentCoroutineContext().ensureActive()
                val count = input.read(buffer)
                if (count < 0) break
                downloaded += count
                if (downloaded > maxBytes || (expectedBody >= 0 && downloaded - startAt > expectedBody)) {
                    throw RestartRequired("invalid_size")
                }
                output.write(buffer, 0, count)
                val now = System.nanoTime()
                if (now - lastProgress >= 500_000_000L) {
                    progress(downloaded, total)
                    lastProgress = now
                }
            }
            output.fd.sync()
        } }
        if (downloaded == 0L || (expectedBody >= 0 && downloaded - startAt != expectedBody) ||
            (total >= 0 && downloaded != total)) throw IOException("incomplete_download")
        progress(downloaded, if (total < 0) downloaded else total)
    }

    private data class Range(val start: Long, val end: Long, val total: Long)

    private fun parseRange(header: String?): Range? {
        val match = Regex("bytes (\\d+)-(\\d+)/(\\d+|\\*)", RegexOption.IGNORE_CASE)
            .matchEntire(header?.trim().orEmpty()) ?: return null
        val start = match.groupValues[1].toLongOrNull() ?: return null
        val end = match.groupValues[2].toLongOrNull() ?: return null
        val total = if (match.groupValues[3] == "*") -1L else match.groupValues[3].toLongOrNull() ?: return null
        if (start < 0 || end < start || end == Long.MAX_VALUE || (total >= 0 && end >= total)) return null
        return Range(start, end, total)
    }
}
