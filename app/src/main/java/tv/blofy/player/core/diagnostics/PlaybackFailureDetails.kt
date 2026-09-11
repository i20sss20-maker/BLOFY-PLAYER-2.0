package tv.blofy.player.core.diagnostics

import android.os.Build
import androidx.annotation.OptIn
import androidx.media3.common.Format
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.HttpDataSource
import androidx.media3.exoplayer.ExoPlaybackException
import androidx.media3.exoplayer.ExoTimeoutException
import androidx.media3.exoplayer.mediacodec.MediaCodecDecoderException
import androidx.media3.exoplayer.mediacodec.MediaCodecRenderer.DecoderInitializationException
import retrofit2.HttpException
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import javax.net.ssl.SSLException

/** Operational fields only: never copy exception messages, request URLs or response bodies. */
@OptIn(markerClass = [UnstableApi::class])
object PlaybackFailureDetails {
    fun describe(error: Throwable, phase: String, videoFormat: Format? = null): String {
        val causes = generateSequence(error) { it.cause }.take(6).toList()
        val fields = mutableListOf("phase=${token(phase)}")
        causes.filterIsInstance<ExoTimeoutException>().firstOrNull()?.let {
            fields += "timeout=" + when (it.timeoutOperation) {
                ExoTimeoutException.TIMEOUT_OPERATION_RELEASE -> "release"
                ExoTimeoutException.TIMEOUT_OPERATION_DETACH_SURFACE -> "detach_surface"
                ExoTimeoutException.TIMEOUT_OPERATION_SET_FOREGROUND_MODE -> "foreground"
                else -> "internal"
            }
        }
        causes.firstNotNullOfOrNull { cause -> when (cause) {
            is HttpDataSource.InvalidResponseCodeException -> cause.responseCode
            is HttpException -> cause.code()
            else -> null
        } }?.let { fields += "http=$it" }
        fields += "cause=" + causes.joinToString(">") { token(it.javaClass.simpleName) }
        causes.firstNotNullOfOrNull { cause -> when (cause) {
            is MediaCodecDecoderException -> cause.codecInfo?.name
            is DecoderInitializationException -> cause.codecInfo?.name
            else -> null
        } }?.let { fields += "decoder=${token(it)}" }
        val rendererError = error as? ExoPlaybackException
        val format = rendererError?.rendererFormat ?: videoFormat
        if (format != null) {
            fields += "mime=${token(format.sampleMimeType.orEmpty())}"
            fields += "size=${format.width}x${format.height}"
            fields += "codec=${token(format.codecs.orEmpty())}"
            format.colorInfo?.let { fields += "color=${it.colorSpace}/${it.colorTransfer}/${it.colorRange}" }
        }
        rendererError?.takeIf { it.type == ExoPlaybackException.TYPE_RENDERER }?.let {
            fields += "support=${it.rendererFormatSupport}"
        }
        fields += "sdk=${Build.VERSION.SDK_INT}"
        fields += "device=${token(Build.MANUFACTURER)}_${token(Build.MODEL)}"
        return fields.joinToString(";").take(512)
    }

    fun requestErrorCode(error: Throwable): String {
        val causes = generateSequence(error) { it.cause }.take(6).toList()
        return when {
            causes.any { it is HttpException || it is HttpDataSource.InvalidResponseCodeException } -> "ERROR_CODE_IO_BAD_HTTP_STATUS"
            causes.any { it is SocketTimeoutException } -> "ERROR_CODE_IO_NETWORK_CONNECTION_TIMEOUT"
            causes.any { it is UnknownHostException || it is SSLException } -> "ERROR_CODE_IO_NETWORK_CONNECTION_FAILED"
            else -> "ERROR_CODE_EPISODE_CATALOG_FAILED"
        }
    }

    private fun token(value: String): String = value.replace(Regex("[^A-Za-z0-9_/-]"), "_").take(64)
}
