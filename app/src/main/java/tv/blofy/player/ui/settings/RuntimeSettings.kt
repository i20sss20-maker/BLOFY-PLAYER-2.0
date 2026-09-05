package tv.blofy.player.ui.settings

import android.content.Context
import androidx.annotation.OptIn
import androidx.media3.common.util.UnstableApi
import androidx.media3.ui.AspectRatioFrameLayout

/** Single runtime source for user-facing settings. Values intentionally match SettingsActivity. */
@OptIn(UnstableApi::class)
object RuntimeSettings {
    const val PREFS = "blofy_player_settings"
    const val KEY_MOTION = "motion_mode"
    const val KEY_AUDIO_OUTPUT = "audio_output"
    const val KEY_SUBTITLE_LANGUAGE = "subtitle_language"
    const val KEY_SUBTITLE_SIZE = "subtitle_size"
    const val KEY_ASPECT = "aspect_mode"
    const val KEY_AUTOPLAY_LIVE = "autoplay_live"
    const val KEY_RESUME_PROMPT = "resume_prompt"
    const val KEY_AUTO_NEXT = "auto_next_episode"

    enum class AutoNext { ASK, ON, OFF }
    enum class SubtitleLanguage { ARABIC_FIRST, AUTO, OFF }

    private fun value(context: Context, key: String, default: String): String =
        context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .getString(key, default).orEmpty().ifBlank { default }

    fun autoplayLive(context: Context): Boolean = value(context, KEY_AUTOPLAY_LIVE, "on") == "on"
    fun askBeforeResume(context: Context): Boolean = value(context, KEY_RESUME_PROMPT, "on") == "on"

    fun autoNext(context: Context): AutoNext = when (value(context, KEY_AUTO_NEXT, "ask")) {
        "on" -> AutoNext.ON
        "off" -> AutoNext.OFF
        else -> AutoNext.ASK
    }

    fun aspectResizeMode(context: Context): Int = when (value(context, KEY_ASPECT, "fit")) {
        "zoom" -> AspectRatioFrameLayout.RESIZE_MODE_ZOOM
        "fill" -> AspectRatioFrameLayout.RESIZE_MODE_FILL
        else -> AspectRatioFrameLayout.RESIZE_MODE_FIT
    }

    fun subtitleSizeSp(context: Context): Float = when (value(context, KEY_SUBTITLE_SIZE, "small")) {
        "large" -> 26f
        "medium" -> 22f
        else -> 18f
    }

    fun subtitleLanguage(context: Context): SubtitleLanguage = when (value(context, KEY_SUBTITLE_LANGUAGE, "ar")) {
        "off" -> SubtitleLanguage.OFF
        "auto" -> SubtitleLanguage.AUTO
        else -> SubtitleLanguage.ARABIC_FIRST
    }

    /** Prefer a stereo track when one is exposed. This does not replace decoder/downmix behavior. */
    fun preferStereoTrack(context: Context): Boolean = value(context, KEY_AUDIO_OUTPUT, "auto") == "stereo"
}
