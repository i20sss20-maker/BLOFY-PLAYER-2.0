package tv.blofy.player.core.diagnostics

import android.content.Context
import tv.blofy.player.R
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import java.net.ConnectException
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import java.security.cert.CertPathValidatorException
import java.util.concurrent.TimeUnit
import javax.net.ssl.SSLException
import androidx.annotation.OptIn
import androidx.media3.common.util.UnstableApi
import androidx.media3.common.PlaybackException
import androidx.media3.datasource.HttpDataSource
import androidx.media3.exoplayer.mediacodec.MediaCodecDecoderException

/** Fixed-origin self-check and safe user-facing error categories; no tokens or stream URLs. */
@OptIn(markerClass = [UnstableApi::class])
object StreamConnectionDiagnostics {
    enum class Cause { CERTIFICATE, DNS, TIMEOUT, OFFLINE_OR_REFUSED, UNAUTHORIZED, SERVER_ERROR, DECODER, OTHER }

    data class Probe(val reachable: Boolean, val cause: Cause?, val status: Int?)

    private val healthClient = OkHttpClient.Builder()
        .callTimeout(10, TimeUnit.SECONDS)
        .connectTimeout(6, TimeUnit.SECONDS)
        .readTimeout(7, TimeUnit.SECONDS)
        .followRedirects(false)
        .followSslRedirects(false)
        .build()

    fun classify(failure: Throwable): Cause {
        val causes = generateSequence(failure) { it.cause }.take(8).toList()
        return when {
            causes.any { it is CertPathValidatorException || it is SSLException } -> Cause.CERTIFICATE
            causes.any { it is UnknownHostException } -> Cause.DNS
            causes.any { it is SocketTimeoutException } -> Cause.TIMEOUT
            causes.any {
                it is MediaCodecDecoderException ||
                    (it is PlaybackException && it.errorCode in 4000..4999)
            } -> Cause.DECODER
            causes.any {
                it is HttpDataSource.InvalidResponseCodeException &&
                    (it.responseCode == 401 || it.responseCode == 403)
            } -> Cause.UNAUTHORIZED
            causes.any {
                it is HttpDataSource.InvalidResponseCodeException &&
                    it.responseCode in 500..599
            } -> Cause.SERVER_ERROR
            causes.any { it is ConnectException } -> Cause.OFFLINE_OR_REFUSED
            else -> Cause.OTHER
        }
    }

    /** The result is deliberately generic; no raw exception messages or HTTP bodies. */
    fun guidance(cause: Cause): String = when (cause) {
        Cause.CERTIFICATE -> "تعذر التحقق من شهادة الاتصال. تأكد من تاريخ الجهاز وتثبيت آخر إصدار من BLOFY STREAM"
        Cause.DNS -> "تعذر العثور على سيرفر BLOFY. افحص DNS أو جرّب شبكة أخرى"
        Cause.TIMEOUT -> "انتهت مهلة الاتصال بالسيرفر. تحقق من سرعة الشبكة وأعد المحاولة"
        Cause.OFFLINE_OR_REFUSED -> "الاتصال غير متاح. تحقق من الإنترنت أو إعدادات الراوتر"
        Cause.UNAUTHORIZED -> "الجلسة غير مخوّلة. افتح حالة الاشتراك أو تواصل مع الدعم"
        Cause.SERVER_ERROR -> "السيرفر لم يستجب بشكل صحيح. جرّب لاحقًا"
        Cause.DECODER -> "صيغة الفيديو غير مدعومة على هذا الجهاز؛ جرّب جودة أقل أو قناة أخرى"
        Cause.OTHER -> "تعذر إكمال الاتصال. جرّب تحديث التطبيق أو افحص الشبكة"
    }

    /** Localized user-facing messages for the independent STREAM interface. */
    fun guidance(context: Context, cause: Cause): String = context.getString(when (cause) {
        Cause.CERTIFICATE -> R.string.stream_ui_cert_error
        Cause.DNS -> R.string.stream_ui_dns_error
        Cause.TIMEOUT -> R.string.stream_ui_timeout_error
        Cause.OFFLINE_OR_REFUSED -> R.string.stream_ui_network_error
        Cause.UNAUTHORIZED -> R.string.stream_ui_unauthorized_error
        Cause.SERVER_ERROR -> R.string.stream_ui_server_error
        Cause.DECODER -> R.string.stream_ui_decoder_error
        Cause.OTHER -> R.string.stream_ui_generic_error
    })

    /**
     * GET /health has no device ID, subscriber code, bearer token or media credentials.
     * A successful health check proves TLS + reachability only, not redeem entitlement.
     */
    suspend fun probe(): Probe = withContext(Dispatchers.IO) {
        val request = Request.Builder()
            .url("https://blofyplayer.com/health")
            .get()
            .header("Cache-Control", "no-store")
            .build()
        try {
            healthClient.newCall(request).execute().use {
                if (it.isSuccessful) Probe(true, null, it.code)
                else Probe(false, if (it.code in 500..599) Cause.SERVER_ERROR else Cause.OTHER, it.code)
            }
        } catch (cancel: CancellationException) {
            throw cancel
        } catch (failure: Exception) {
            Probe(false, classify(failure), null)
        }
    }
}
