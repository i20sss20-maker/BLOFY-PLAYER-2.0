package tv.blofy.player.core.theme

import android.content.Context

object ThemeManager {
    private const val PREFS = "blofy_theme"
    private const val KEY_THEME = "theme_id"

    fun current(context: Context): ThemeProfile {
        return when (context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY_THEME, BlofyThemes.VISION.id)) {
            BlofyThemes.CINEMA.id -> BlofyThemes.CINEMA
            else -> BlofyThemes.VISION
        }
    }

    fun set(context: Context, theme: ThemeProfile) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit()
            .putString(KEY_THEME, theme.id)
            .apply()
    }

    fun toggle(context: Context): ThemeProfile {
        val next = if (current(context).id == BlofyThemes.VISION.id) BlofyThemes.CINEMA else BlofyThemes.VISION
        set(context, next)
        return next
    }
}
