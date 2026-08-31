package tv.blofy.player.core.theme

import android.content.Context

object ThemeManager {
    private const val PREFS = "blofy_theme"
    private const val KEY_THEME = "theme_id"

    /** The application now intentionally uses the original BLOFY theme only. */
    fun current(context: Context): ThemeProfile = BlofyThemes.ORIGINAL

    fun set(context: Context, theme: ThemeProfile) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit()
            .putString(KEY_THEME, BlofyThemes.ORIGINAL.id)
            .apply()
    }

    fun toggle(context: Context): ThemeProfile {
        set(context, BlofyThemes.ORIGINAL)
        return BlofyThemes.ORIGINAL
    }
}
