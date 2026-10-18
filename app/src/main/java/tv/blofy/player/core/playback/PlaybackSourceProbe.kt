package tv.blofy.player.core.playback

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import tv.blofy.player.core.network.awaitResponse
import java.util.concurrent.TimeUnit

/**
 * On-demand check of the selected stream. Never transmits the stream URL,
 * credentials, response body or headers to BLOFY telemetry.
 * GET + Range is used instead of HEAD as many IPTV endpoints reject HEAD.
 */
internal object PlaybackSourceProbe {
    private val client = OkHttpClient.Builder()
        .connectTimeout(5, TimeUnit.SECONDS)
        .readTimeout(6, TimeUnit.SECONDS)
        .callTimeout(12, TimeUnit.SECONDS)
        .followRedirects(true)
        .followSslRedirects(true)
        .build()

    suspend fun inspect(url: String): String = withContext(Dispatchers.IO) {
        if (!(url.startsWith("http://", ignoreCase = true) ||
                    url.startsWith("https://", ignoreCase = true))) {
            return@withContext "هذا المصدر لا يستخدم HTTP أو HTTPS؛ لا يمكن فحصه بهذه الأداة."
        }
        try {
            val request = Request.Builder().url(url)
                .header("Range", "bytes=0-1023")
                .header("Accept-Encoding", "identity")
                .header("User-Agent", "BLOFY PLAYER/2.0")
                .get().build()
            client.newCall(request).awaitResponse().use { response ->
                PlaybackProbePolicy.summarize(
                    code = response.code,
                    contentType = response.header("Content-Type")
                )
            }
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (e: Exception) {
            // Never print exception messages: they often embed full URLs with passwords.
            when (e) {
                is java.net.SocketTimeoutException, is java.io.InterruptedIOException ->
                    "اختبار الاتصال: انتهت المهلة. المصدر بطيء أو لا يرسل بيانات."
                is java.net.UnknownHostException ->
                    "اختبار الاتصال: تعذر الوصول إلى اسم السيرفر (DNS)."
                is javax.net.ssl.SSLException ->
                    "اختبار الاتصال: شهادة HTTPS أو الاتصال المشفر غير صالح."
                else -> "تعذر اختبار الاتصال بالمصدر."
            }
        }
    }
}

/** Pure renderer of safe test outcomes: no host, URL or subscriber data. */
internal object PlaybackProbePolicy {
    fun summarize(code: Int, contentType: String?): String {
        val type = contentType.orEmpty().substringBefore(';').trim().lowercase()
        return when {
            code == 401 || code == 403 -> "المصدر رفض الوصول (HTTP $code). افحص الاشتراك وصلاحية الحساب."
            code == 404 || code == 410 -> "المصدر غير موجود (HTTP $code). حدّث قائمة التشغيل."
            code == 429 -> "طلبات كثيرة (HTTP 429). انتظر قبل إعادة المحاولة."
            code in 500..599 -> "خطأ داخل السيرفر (HTTP $code). المصدر لا يستجيب بشكل سليم."
            code in 200..299 && type == "text/html" ->
                "المصدر يرجع صفحة HTML بدل الفيديو (HTTP $code). قد يكون هناك تسجيل دخول أو حظر من المزود."
            code in 200..299 && (type == "application/json" || type.endsWith("+json")) ->
                "المصدر يرجع JSON بدل الفيديو (HTTP $code). تحقق من رابط الفيديو وبيانات الاشتراك."
            code in 200..299 -> "اتصال ناجح بالمصدر (HTTP $code). استمرار الفشل قد يشير للترميز أو الفيديو/الصوت أو قيود المشغل."
            code in 300..399 -> "المصدر يطلب إعادة توجيه (HTTP $code). راجع سماح المزود بالتحويل."
            else -> "المصدر أعاد HTTP $code. تحقق من الإعدادات وصلاحية الرابط."
        }
    }
}
