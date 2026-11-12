package tv.blofy.player.ui.player

/**
 * State only. A first video frame or HTTP 200 does not prove that audio decoded.
 * The labels deliberately distinguish absent media tracks from an installed
 * decoder being unable to handle a discovered track.
 */
internal object AudioTrackUiPolicy {
    fun buttonLabel(playerReady: Boolean, totalTracks: Int, supportedTracks: Int): String = when {
        supportedTracks > 1 -> "🔊 الصوت ($supportedTracks)"
        supportedTracks > 0 -> "🔊 الصوت"
        totalTracks > 0 -> "⚠ ترميز صوت غير مدعوم"
        playerReady -> "🔇 لا يوجد مسار صوت"
        else -> "🔊 الصوت"
    }

    fun unavailableMessage(playerReady: Boolean, totalTracks: Int, codecSummary: String = ""): String {
        if (totalTracks > 0) {
            val codec = codecSummary.takeIf { it.isNotBlank() }?.let { " ($it)" }.orEmpty()
            return "تم اكتشاف مسار صوتي$codec ولكن الجهاز لا يدعم تشغيله. قد تحتاج نسخة تتضمن مفكك الترميز المناسب أو جهازًا يدعم الصيغة."
        }
        return if (playerReady) {
            "لم يعثر المشغل على مسار صوت في هذا المصدر. جرّب قناة أخرى أو افحص مسار الصوت في المصدر."
        } else {
            "جارٍ قراءة المسارات الصوتية. انتظر حتى يبدأ التشغيل ثم افتح القائمة مجددًا."
        }
    }
}
