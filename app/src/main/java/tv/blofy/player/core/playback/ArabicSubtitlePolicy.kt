package tv.blofy.player.core.playback

/** Automatic defaults never override an explicit subtitle selection. */
class ArabicSubtitlePolicy {
    var manual = false
    var disabledAutomatically = false

    fun reset() { manual = false; disabledAutomatically = false }

    fun textDisabled(selectedAudioLanguage: String?): Boolean? {
        if (manual) return null
        val language = selectedAudioLanguage?.trim()?.lowercase(java.util.Locale.ROOT)
            ?.replace('_', '-')?.substringBefore('-')
        if (language.isNullOrBlank() || language == "und") return null
        if (language == "ar" || language == "ara") {
            disabledAutomatically = true
            return true
        }
        if (disabledAutomatically) {
            disabledAutomatically = false
            return false
        }
        return null
    }
}
