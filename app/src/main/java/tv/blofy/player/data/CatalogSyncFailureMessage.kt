package tv.blofy.player.data

import java.io.EOFException
import java.net.ConnectException
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import javax.net.ssl.SSLException
import retrofit2.HttpException

/** User-facing diagnostics without exposing upstream URLs or login credentials. */
internal object CatalogSyncFailureMessage {
    fun describe(error: Throwable): String {
        val causes = generateSequence(error) { it.cause }.take(12).toList()
        val http = causes.filterIsInstance<HttpException>().firstOrNull()
        if (http != null) return when (http.code()) {
            401, 403 -> "رفض السيرفر بيانات الاشتراك أو انتهت صلاحيتها"
            404 -> "مسار خدمة الباقة غير متاح على السيرفر"
            429 -> "السيرفر مشغول بكثرة الطلبات • حاول مجددًا"
            in 500..599 -> "السيرفر لا يستجيب بشكل سليم حاليًا • حاول مجددًا"
            else -> "تعذر استلام بيانات الباقة من السيرفر"
        }
        if (causes.any { it is UnknownHostException }) return "تعذر العثور على عنوان السيرفر • تحقق من الشبكة"
        if (causes.any { it is ConnectException }) return "تعذر إنشاء اتصال بالسيرفر • تحقق من الشبكة"
        if (causes.any { it is SocketTimeoutException }) return "انتهت مهلة استجابة السيرفر • يمكنك إعادة المحاولة"
        if (causes.any { it is EOFException }) return "انقطع نقل بيانات الباقة قبل اكتمالها • يمكنك إعادة المحاولة"
        if (causes.any { it is SSLException }) return "تعذر إنشاء اتصال آمن بالسيرفر"
        val message = error.message.orEmpty()
        if (message.startsWith("تعذر تحديث: ")) return message
        if (message == "لم يرجع السيرفر محتوى صالح") return message
        return "تعذر تحديث الباقة • تأكد من الاتصال ثم أعد المحاولة"
    }
}
