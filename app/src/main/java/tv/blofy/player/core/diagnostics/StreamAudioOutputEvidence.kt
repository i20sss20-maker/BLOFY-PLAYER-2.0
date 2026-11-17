package tv.blofy.player.core.diagnostics

/**
 * Live-player-only, in-memory Media3 audio renderer evidence. These signals
 * describe local decoder and audio-sink activity; none of them proves that
 * audible sound left the television's speakers or that the source is healthy.
 *
 * Never accept URLs, credentials, source IDs, filenames or exception text.
 * A fresh channel/session must call reset() before sampling new events.
 */
internal class StreamAudioOutputEvidence {
    enum class Signal {
        WAITING_FOR_DECODER,
        DECODER_INITIALIZED,
        AUDIO_POSITION_ADVANCED,
        SINK_ERROR_OBSERVED,
        CODEC_ERROR_OBSERVED
    }

    private var decoderSeen = false
    private var advancingSeen = false
    private var sinkErrorSeen = false
    private var codecErrorSeen = false
    private var underruns = 0

    fun reset() {
        decoderSeen = false
        advancingSeen = false
        sinkErrorSeen = false
        codecErrorSeen = false
        underruns = 0
    }

    fun onDecoderInitialized() { decoderSeen = true }
    fun onPositionAdvancing() { advancingSeen = true }
    fun onSinkError() { sinkErrorSeen = true }
    fun onCodecError() { codecErrorSeen = true }
    fun onUnderrun() { underruns = (underruns + 1).coerceAtMost(5) }

    fun signal(): Signal = when {
        codecErrorSeen -> Signal.CODEC_ERROR_OBSERVED
        sinkErrorSeen -> Signal.SINK_ERROR_OBSERVED
        advancingSeen -> Signal.AUDIO_POSITION_ADVANCED
        decoderSeen -> Signal.DECODER_INITIALIZED
        else -> Signal.WAITING_FOR_DECODER
    }

    fun summary(audio: StreamAudioHealth.Summary, language: String): String {
        val ar = language.equals("ar", ignoreCase = true) ||
            language.startsWith("ar-", ignoreCase = true)
        if (audio.state != StreamAudioHealth.State.AUDIO_TRACK_SELECTED) {
            return if (ar) "دليل مخرج الصوت: لم يثبت تشغيل صوت قابل للاستخدام بعد." else
                "Audio output: usable audio playback has not been established."
        }
        val details = when (signal()) {
            Signal.WAITING_FOR_DECODER ->
                if (ar) "لم تُرصد تهيئة مفكك الصوت بعد." else "Audio decoder initialization not observed yet."
            Signal.DECODER_INITIALIZED ->
                if (ar) "تهيّأ مفكك الصوت، ولم يُرصد تقدّم الإخراج بعد." else
                    "Audio decoder initialized; output progress not observed."
            Signal.AUDIO_POSITION_ADVANCED ->
                if (ar) "رُصد تقدّم الصوت داخل Media3." else
                    "Media3 audio output position advanced."
            Signal.SINK_ERROR_OBSERVED ->
                if (ar) "رُصد خطأ في مخرج الصوت؛ قد يكون مؤقتًا." else
                    "An audio sink error was observed; it may be transient."
            Signal.CODEC_ERROR_OBSERVED ->
                if (ar) "رُصد خطأ في مفكك ترميز الصوت." else
                    "An audio decoder error was observed."
        }
        val underrunText = if (underruns > 0) {
            if (ar) " · انقطاعات تغذية الصوت المرصودة: $underruns" else
                " · Audio underruns observed: $underruns"
        } else ""
        val disclaimer = if (ar)
            "هذا لا يؤكد سماع الصوت من التلفزيون."
        else "This does not confirm audible sound from the television."
        return "$details$underrunText\n$disclaimer"
    }

    fun safeCode(): String =
        "decoder=${if (decoderSeen) 1 else 0};advancing=${if (advancingSeen) 1 else 0};" +
            "sink_error=${if (sinkErrorSeen) 1 else 0};codec_error=${if (codecErrorSeen) 1 else 0};" +
            "underruns=$underruns"
}
