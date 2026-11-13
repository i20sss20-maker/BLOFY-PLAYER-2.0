package tv.blofy.player.ui.player

import android.content.Context

/** Remember only a preferred audio LANGUAGE across episodes, never a track ID. */
internal object StreamAudioPreferences {
    private const val PREFS = "blofy_stream_audio_language_v1"
    private const val KEY = "preferred"
    private val language = Regex("^[a-zA-Z]{2,3}(-[a-zA-Z]{2,4})?$")

    fun preferred(context: Context): String? =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .getString(KEY, null)?.takeIf { it.matches(language) }

    fun save(context: Context, value: String?) {
        val normalized = value?.trim()?.lowercase()
            ?.takeIf { it.matches(language) }
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit().putString(KEY, normalized).apply()
    }
}
