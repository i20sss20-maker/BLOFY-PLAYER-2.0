package tv.blofy.player.core.playback

import androidx.media3.common.PlaybackException
import androidx.media3.datasource.HttpDataSource

/** Messages shown to users must never include stream URLs, user names or passwords. */
internal data class PlaybackFailureInfo(val message: String, val authFailure: Boolean, val tryHttpTransport: Boolean)

internal object PlaybackFailurePolicy {
    fun httpStatus(error: Throwable?): Int? {
        var current = error
        val visited = HashSet<Throwable>()
        while (current != null && visited.add(current)) {
            if (current is HttpDataSource.InvalidResponseCodeException) return current.responseCode
            current = current.cause
        }
        return null
    }

    fun describe(code: String, status: Int? = null): PlaybackFailureInfo = when (status) {
        401, 403 -> PlaybackFailureInfo(
            "رفض السيرفر صلاحية التشغيل (HTTP $status). تحقق من صلاحية الاشتراك وربط الجهاز أو بيانات قائمة التشغيل.",
            authFailure = true, tryHttpTransport = false
        )
        404, 410 -> PlaybackFailureInfo(
            "رابط الفيديو غير متاح لدى المزود (HTTP $status). جرّب محتوى آخر أو حدّث القائمة.",
            authFailure = false, tryHttpTransport = false
        )
        429 -> PlaybackFailureInfo(
            "السيرفر يحدّ عدد طلبات التشغيل (HTTP 429). انتظر قليلًا قبل إعادة المحاولة.",
            authFailure = false, tryHttpTransport = false
        )
        in 500..599 -> PlaybackFailureInfo(
            "السيرفر لا يستجيب بصورة صحيحة (HTTP $status). قد يكون المصدر متوقفًا مؤقتًا.",
            authFailure = false, tryHttpTransport = true
        )
        else -> when {
            code.startsWith("ERROR_CODE_IO_") -> PlaybackFailureInfo(
                "تعذر الاتصال بمصدر الفيديو ($code). تحقق من الإنترنت وصلاحية الرابط، ثم أعد المحاولة.",
                authFailure = false, tryHttpTransport = status == null || status in 500..599
            )
            code.contains("DECOD", true) || code.contains("FORMAT", true) -> PlaybackFailureInfo(
                "صيغة الفيديو أو الترميز غير مدعوم على هذا الجهاز ($code). جرّب جودة أو مصدرًا آخر.",
                authFailure = false, tryHttpTransport = false
            )
            code.contains("DRM", true) -> PlaybackFailureInfo(
                "المحتوى محمي ويلزم ترخيص تشغيل متوافق من المزوّد ($code).",
                authFailure = false, tryHttpTransport = false
            )
            else -> PlaybackFailureInfo(
                "تعذر تشغيل هذا المحتوى ($code). جرّب إعادة المحاولة أو مصدرًا مختلفًا.",
                authFailure = false, tryHttpTransport = false
            )
        }
    }

    fun from(error: PlaybackException): PlaybackFailureInfo =
        describe(error.errorCodeName, httpStatus(error))
}
