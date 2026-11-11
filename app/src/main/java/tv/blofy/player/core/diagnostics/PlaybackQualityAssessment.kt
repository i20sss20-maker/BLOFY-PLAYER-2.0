package tv.blofy.player.core.diagnostics

/**
 * Locally derived observations, not guesses about an upstream media source.
 * No credentials, stream IDs, URLs or playlist names leave the player.
 */
object PlaybackQualityAssessment {
    enum class Cause {
        ACCESS_DENIED, CONTENT_MISSING, SOURCE_LIMIT, SOURCE_RESPONSE,
        DECODER, CONNECTION, AUDIO_CODEC, AUDIO_SELECTION,
        REBUFFERING, SLOW_START, PLAYING, NOT_READY
    }
    data class Result(val cause: Cause, val titleAr: String, val adviceAr: String)

    fun classify(metric: PlaybackMetric, audio: StreamAudioHealth.State? = null): Result {
        // Error details come only from PlaybackFailureDetails' sanitized key/value
        // fields; never inspect URL, provider identity or arbitrary exception text.
        val status = Regex("(?:^|;)http=([0-9]{3})(?:;|$)")
            .find(metric.errorMessage.orEmpty())?.groupValues?.get(1)?.toIntOrNull()
        val error = metric.errorCode.orEmpty()
        val cause = when {
            status == 401 || status == 403 -> Cause.ACCESS_DENIED
            status == 404 || status == 410 -> Cause.CONTENT_MISSING
            status == 429 -> Cause.SOURCE_LIMIT
            status != null && status in 500..599 -> Cause.SOURCE_RESPONSE
            error.contains("DECOD") || error.contains("RENDERER") -> Cause.DECODER
            error.contains("NETWORK") || error.contains("TIMEOUT") || error.contains("UNSPECIFIED") &&
                metric.firstFrameElapsedMs == null -> Cause.CONNECTION
            audio == StreamAudioHealth.State.UNSUPPORTED_AUDIO_CODEC -> Cause.AUDIO_CODEC
            audio == StreamAudioHealth.State.SUPPORTED_NOT_SELECTED -> Cause.AUDIO_SELECTION
            metric.rebufferCount >= 2 || metric.rebufferDurationMs >= 8_000L -> Cause.REBUFFERING
            (metric.ttffMs ?: 0) > 8_000L -> Cause.SLOW_START
            metric.firstFrameElapsedMs != null -> Cause.PLAYING
            else -> Cause.NOT_READY
        }
        return when (cause) {
            Cause.ACCESS_DENIED -> Result(cause,"رفض من المصدر (401/403)","تحقق من حالة الاشتراك والصلاحيات؛ إعادة المحاولة لن تعالج رمز الرفض.")
            Cause.CONTENT_MISSING -> Result(cause,"الرابط غير موجود (404/410)","تحقق من رقم الحلقة أو القناة والفهرسة؛ لا تكرر نفس الرابط.")
            Cause.SOURCE_LIMIT -> Result(cause,"المصدر يحدد عدد الطلبات (429)","خفف اتصالات الفحص واترك فترة بين المحاولات.")
            Cause.SOURCE_RESPONSE -> Result(cause,"المصدر أو البوابة يرجع خطأ خادم","راجع صحة المصدر ووقت الاستجابة، ثم جرّب مسارًا احتياطيًا مصرحًا.")
            Cause.DECODER -> Result(cause,"مشكلة فك ترميز في الجهاز","تحقق من ترميز الفيديو ومسار الصوت ومشغل التوافق.")
            Cause.CONNECTION -> Result(cause,"مشكلة في اتصال التشغيل","قد تكون من الشبكة أو المصدر؛ افحص الاتصال وطلبات البوابة.")
            Cause.AUDIO_CODEC -> Result(cause,"ترميز الصوت غير مدعوم","افحص محرك الصوت والترميز على الجهاز دون إعادة تشغيل الفيديو السليم.")
            Cause.AUDIO_SELECTION -> Result(cause,"لم يتم اختيار مسار صوت مدعوم","اختر مسار الصوت من أدوات المشغل.")
            Cause.REBUFFERING -> Result(cause,"تخزين مؤقت متكرر","افحص ثبات تدفق الفيديو ومعدل النقل، وليس استجابة قائمة الأفلام فقط.")
            Cause.SLOW_START -> Result(cause,"تأخر ظهور أول صورة","قارن زمن جلب المصدر بوقت تجهيز المشغل على هذا الجهاز.")
            Cause.PLAYING -> Result(cause,"بدء تشغيل ناجح","ظهرت أول صورة؛ هذا لا يؤكد استمرار التشغيل دون تقطيع.")
            Cause.NOT_READY -> Result(cause,"لم تتوفر نتيجة تشغيل بعد","ابدأ قناة أو فيلمًا أو حلقة، ثم افتح هذا التقرير.")
        }
    }

    fun medianStartMs(metrics: List<PlaybackMetric>): Long? {
        val values = metrics.mapNotNull { it.ttffMs?.takeIf { v -> v in 0..600_000L } }.sorted()
        return values.takeIf { it.isNotEmpty() }?.get(values.size / 2)
    }
}
