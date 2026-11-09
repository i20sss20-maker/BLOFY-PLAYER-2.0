package tv.blofy.player.core.playback

/** Customer-safe playback hints. Never expose upstream URLs or credentials. */
internal object PlaybackFailureHint {
    fun message(errorCodeName: String): String {
        val code = errorCodeName.uppercase()
        return when {
            "BAD_HTTP_STATUS" in code ->
                "المصدر رفض طلب التشغيل أو القناة غير متاحة. جرّب مجددًا أو اختر قناة أخرى."
            "NETWORK_CONNECTION_TIMEOUT" in code || "TIMEOUT" in code ->
                "انتهت مهلة الاتصال بالمصدر. تحقق من الشبكة ثم اضغط إعادة المحاولة."
            "NETWORK_CONNECTION_FAILED" in code || "IO_UNSPECIFIED" in code ->
                "تعذّر الاتصال بمصدر الفيديو. حاول مرة أخرى بعد التحقق من الإنترنت."
            "DECODING" in code || "FORMAT_UNSUPPORTED" in code ||
                "FAILED_RUNTIME_CHECK" in code ->
                "تعذّر فك ترميز الفيديو على هذا الجهاز. قد لا يدعم الجهاز صيغة القناة."
            "BEHIND_LIVE_WINDOW" in code ->
                "تأخر البث المباشر عن نافذة التشغيل. أعد تحميل القناة."
            else -> "تعذّر تشغيل المحتوى. جرّب إعادة المحاولة أو اختر محتوى آخر."
        }
    }
}
