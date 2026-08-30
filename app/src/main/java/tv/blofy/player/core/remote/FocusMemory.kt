package tv.blofy.player.core.remote

import android.content.Context

object FocusMemory {
    private const val PREFS = "blofy_focus_memory"

    fun save(context: Context, screen: String, key: String) {
        if (screen.isBlank() || key.isBlank()) return
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit()
            .putString(screen, key)
            .apply()
    }

    fun restore(context: Context, screen: String): String? =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(screen, null)

    fun clear(context: Context, screen: String) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().remove(screen).apply()
    }
}
