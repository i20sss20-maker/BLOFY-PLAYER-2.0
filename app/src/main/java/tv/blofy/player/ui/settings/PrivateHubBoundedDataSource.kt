package tv.blofy.player.ui.settings

import android.net.Uri
import androidx.annotation.OptIn
import androidx.media3.common.C
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.BaseDataSource
import androidx.media3.datasource.DataSpec
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import java.io.IOException
import java.io.InputStream
import java.util.concurrent.TimeUnit
import kotlin.math.min

/**
 * Debug-only S3-backed owner playback. Media3 normally sends open-ended
 * HTTP Range requests which the private QA bridge correctly DENIES.
 * This source converts player reads/seeks to EXPLICIT <=8MiB ranges.
 *
 * NEVER used by release apps, customer streams or regular Xtream playback.
 * No provider credentials, token URL query params, redirects or disk cache.
 */
@OptIn(UnstableApi::class)
internal class PrivateHubBoundedDataSource(
    private val endpoint: String,
    private val ticket: String,
    private val platform: String
) : BaseDataSource(true) {
    private val client = OkHttpClient.Builder()
        .followRedirects(false).followSslRedirects(false)
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(45, TimeUnit.SECONDS)
        .callTimeout(90, TimeUnit.SECONDS)
        .build()
    private var expectedUri: Uri = Uri.parse(endpoint)
    private var opened = false
    private var total = 0L
    private var position = 0L
    private var left = 0L
    private var segmentLeft = 0L
    private var activeResponse: Response? = null
    private var activeStream: InputStream? = null
    private val allowedContentTypes = setOf(
        "video/mp4", "video/x-matroska", "video/mp2t", "video/x-msvideo"
    )
    private var mediaType = ""

    private fun request(method: String, range: String? = null): Response {
        val b = Request.Builder().url(endpoint)
            .header("Authorization", "Bearer $ticket")
            .header("x-blofy-device-platform", platform)
            .header("Cache-Control", "no-store")
            .header("Accept-Encoding", "identity")
        if (range != null) b.header("Range", range)
        if (method == "HEAD") b.head() else b.get()
        return client.newCall(b.build()).execute()
    }

    override fun open(dataSpec: DataSpec): Long {
        if (opened || dataSpec.uri != expectedUri) throw IOException("qa_uri_invalid")
        transferInitializing(dataSpec)
        try {
            request("HEAD").use { head ->
                if (head.code != 200) throw IOException("qa_ticket_or_verified_media_unavailable")
                val length = head.header("Content-Length")?.toLongOrNull()
                val type = head.header("Content-Type")?.substringBefore(';')?.trim()
                if (length == null || length < 1 || length > 4L * 1024 * 1024 * 1024 ||
                    type !in allowedContentTypes) throw IOException("qa_private_media_invalid")
                total = length
                mediaType = type!!
            }
            if (dataSpec.position < 0 || dataSpec.position >= total)
                throw IOException("qa_seek_outside_private_media")
            position = dataSpec.position
            left = if (dataSpec.length == C.LENGTH_UNSET.toLong()) {
                total - position
            } else {
                min(dataSpec.length, total - position)
            }
            if (left <= 0) throw IOException("qa_empty_media_range")
            opened = true
            transferStarted(dataSpec)
            return left
        } catch (e: Exception) {
            close()
            throw IOException("qa_private_metadata_failed", e)
        }
    }

    private fun nextSegment() {
        val bytes = min(left, 8L * 1024 * 1024)
        val last = position + bytes - 1
        val response = request("GET", "bytes=$position-$last")
        val exact = "bytes $position-$last/$total"
        if (response.code != 206 || response.header("Content-Range") != exact ||
            response.header("Content-Length")?.toLongOrNull() != bytes ||
            response.header("Content-Type")?.substringBefore(';')?.trim() != mediaType ||
            response.body == null) {
            response.close()
            throw IOException("qa_bounded_private_range_invalid")
        }
        activeResponse = response
        activeStream = response.body!!.byteStream()
        segmentLeft = bytes
    }

    override fun read(buffer: ByteArray, offset: Int, length: Int): Int {
        if (!opened) throw IOException("qa_not_open")
        if (length == 0) return 0
        if (left <= 0) return C.RESULT_END_OF_INPUT
        if (segmentLeft == 0L) {
            activeStream?.close()
            activeResponse?.close()
            activeStream = null
            activeResponse = null
            nextSegment()
        }
        val count = min(length.toLong(), min(segmentLeft, left)).toInt()
        val read = activeStream?.read(buffer, offset, count) ?: -1
        if (read <= 0) throw IOException("qa_private_range_short")
        position += read
        left -= read
        segmentLeft -= read
        bytesTransferred(read)
        return read
    }

    override fun getUri(): Uri? = if (opened) expectedUri else null

    override fun close() {
        activeStream?.close()
        activeResponse?.close()
        activeStream = null
        activeResponse = null
        segmentLeft = 0L
        if (opened) {
            opened = false
            transferEnded()
        }
        left = 0
    }
}
