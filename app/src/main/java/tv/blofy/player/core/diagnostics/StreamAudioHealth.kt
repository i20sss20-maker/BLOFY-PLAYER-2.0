package tv.blofy.player.core.diagnostics

import androidx.media3.common.C
import androidx.media3.common.Tracks

/**
 * Read-only Media3 audio diagnosis. The stream URL, account, provider,
 * source metadata and device identity must never be logged or exported.
 *
 * Video rendering does not prove audio was decoded or sent to the TV.
 * This class deliberately does not restart a healthy video stream, alter
 * audio track selection, or claim that audio is actually audible.
 */
object StreamAudioHealth {
    enum class State {
        NOT_YET_DISCOVERED,
        NO_AUDIO_TRACK,
        UNSUPPORTED_AUDIO_CODEC,
        SUPPORTED_NOT_SELECTED,
        PLAYER_VOLUME_MUTED,
        AUDIO_TRACK_SELECTED
    }

    data class Summary(
        val state: State,
        val available: Int,
        val supported: Int,
        val selected: Int,
        val selectedMimeType: String?
    ) {
        fun safeLogCode(): String =
            "state=${state.name};available=$available;supported=$supported;" +
                "selected=$selected;mime=${selectedMimeType ?: "none"}"

        fun explanationAr(): String = when (state) {
            State.NOT_YET_DISCOVERED ->
                "جاري فحص مسار الصوت. إذا كانت القناة تعمل، افتح الصوت بعد ظهور الصورة."
            State.NO_AUDIO_TRACK ->
                "ما اكتشف التطبيق مسارًا صوتيًا في القناة. قد تكون بيانات المصدر لا تحتوي صوتًا."
            State.UNSUPPORTED_AUDIO_CODEC ->
                "القناة تحتوي صوتًا، لكن جهازك لا يدعم الترميز المكتشف. تحتاج نسخة بمحرك فك صوت مناسب."
            State.SUPPORTED_NOT_SELECTED ->
                "القناة تحتوي مسار صوت مدعومًا لكنه غير محدد. اختر مسارًا من قائمة الصوت."
            State.PLAYER_VOLUME_MUTED ->
                "صوت المشغل مكتوم. ارفع الصوت من التطبيق والجهاز ثم أعد المحاولة."
            State.AUDIO_TRACK_SELECTED ->
                "مسار الصوت محدد ويدعمه الجهاز بحسب Media3. إذا استمر الصمت، افحص مخرج الصوت أو إعدادات التلفزيون."
        }

        fun explanationEn(): String = when (state) {
            State.NOT_YET_DISCOVERED -> "Checking audio tracks. Try again after video starts."
            State.NO_AUDIO_TRACK -> "No audio track was detected in this channel. The source may not carry audio."
            State.UNSUPPORTED_AUDIO_CODEC -> "The channel has audio, but this device cannot decode the detected format. Try a build with a compatible audio decoder."
            State.SUPPORTED_NOT_SELECTED -> "An audio track is supported but not selected. Choose it from the audio track list."
            State.PLAYER_VOLUME_MUTED -> "Player volume is muted. Check the app and TV volume."
            State.AUDIO_TRACK_SELECTED -> "A supported audio track is selected, but audible output is not confirmed. Check TV audio output if it is still silent."
        }

        fun explanationFor(language: String): String =
            if (language.equals("ar", ignoreCase = true) || language.startsWith("ar-", ignoreCase = true))
                explanationAr() else explanationEn()
    }

    /** Pure classification for deterministic unit testing without live media. */
    fun classify(total: Int, supported: Int, selected: Int, volume: Float, known: Boolean): State {
        if (!known) return State.NOT_YET_DISCOVERED
        if (total <= 0) return State.NO_AUDIO_TRACK
        if (supported <= 0) return State.UNSUPPORTED_AUDIO_CODEC
        if (selected <= 0) return State.SUPPORTED_NOT_SELECTED
        if (volume <= 0f) return State.PLAYER_VOLUME_MUTED
        return State.AUDIO_TRACK_SELECTED
    }

    fun inspect(tracks: Tracks, volume: Float, known: Boolean = true): Summary {
        val groups = tracks.groups.filter { it.type == C.TRACK_TYPE_AUDIO }
        var available = 0
        var supported = 0
        var selected = 0
        var selectedMime: String? = null
        for (group in groups) {
            for (index in 0 until group.length) {
                available++
                val isSupported = group.isTrackSupported(index)
                if (isSupported) supported++
                // Selected-but-unsupported must not be reported as usable audio.
                // A different supported track can still be chosen by the viewer.
                if (group.isTrackSelected(index) && isSupported) {
                    selected++
                    if (selectedMime == null) {
                        selectedMime = group.getTrackFormat(index).sampleMimeType
                            ?.take(48)
                            ?.takeIf { it.matches(Regex("[A-Za-z0-9._/+-]+")) }
                    }
                }
            }
        }
        return Summary(
            classify(available, supported, selected, volume, known),
            available, supported, selected, selectedMime
        )
    }
}
