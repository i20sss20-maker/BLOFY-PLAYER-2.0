package tv.blofy.player.ui.player

import android.content.Context

/**
 * Last approved Arabic commentary selection per STREAM live channel.
 * Only a first-party audio ID and bounded delay are kept on the device.
 * No URL, source password, device code or session bearer is persisted.
 * A saved choice is never auto-played without the user choosing it.
 */
internal object StreamAudioPreferenceStore {
    private const val PREFS = "blofy_stream_audio_preferences"
    private val channelPattern = Regex("[1-9][0-9]{0,14}")
    private val trackPattern = Regex("anis-[a-z0-9-]{1,60}")
    data class Choice(val trackId: String, val delaySeconds: Int)

    fun read(context: Context, channelId: String): Choice? {
        if (!channelPattern.matches(channelId)) return null
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val id = prefs.getString("voice_$channelId", null) ?: return null
        if (!trackPattern.matches(id)) return null
        val delay = prefs.getInt("delay_$channelId", 0)
        return Choice(id, ArabicSidecarTimingPolicy.clamp(delay))
    }

    fun save(context: Context, channelId: String, trackId: String, delaySeconds: Int): Boolean {
        if (!channelPattern.matches(channelId) || !trackPattern.matches(trackId)) return false
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putString("voice_$channelId", trackId)
            .putInt("delay_$channelId", ArabicSidecarTimingPolicy.clamp(delaySeconds))
            .commit()
    }

    fun clear(context: Context, channelId: String) {
        if (!channelPattern.matches(channelId)) return
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .remove("voice_$channelId").remove("delay_$channelId").apply()
    }
}
