package tv.blofy.player.data

import android.content.Context

/** Explicit per-source preference. Never silently switch every subscriber to a different API. */
internal object M3uOrderingPreference {
    private const val PREFS = "blofy_m3u_order_matching"
    fun enabled(context: Context, providerId: String): Boolean =
        context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .getBoolean(providerId, false)
    fun disable(context: Context, providerId: String) {
        context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit().remove(providerId).apply()
    }
    fun enable(context: Context, providerId: String) {
        check(context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit().putBoolean(providerId, true).commit()) {
            "Could not remember M3U ordering mode"
        }
    }
}
