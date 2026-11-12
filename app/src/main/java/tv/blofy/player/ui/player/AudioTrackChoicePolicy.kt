package tv.blofy.player.ui.player

/** Stable mapping between Media3 track indices and dialog rows. */
internal object AudioTrackChoicePolicy {
    enum class Choice { AUTO, OFF, TRACK }

    fun optionOffset(audio: Boolean, subtitles: Boolean, availableTracks: Int): Int =
        if (availableTracks <= 0) 0 else if (audio || subtitles) 1 else 0

    fun choice(audio: Boolean, subtitles: Boolean, option: Int, availableTracks: Int): Choice? {
        if (option < 0 || availableTracks <= 0) return null
        if (audio && option == 0) return Choice.AUTO
        if (subtitles && option == 0) return Choice.OFF
        return if (option - optionOffset(audio, subtitles, availableTracks) in 0 until availableTracks)
            Choice.TRACK else null
    }

    fun trackIndex(audio: Boolean, subtitles: Boolean, option: Int, availableTracks: Int): Int? =
        if (choice(audio, subtitles, option, availableTracks) == Choice.TRACK)
            option - optionOffset(audio, subtitles, availableTracks) else null
}
