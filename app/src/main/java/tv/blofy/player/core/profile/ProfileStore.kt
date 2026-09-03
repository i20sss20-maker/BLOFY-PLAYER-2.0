package tv.blofy.player.core.profile

import android.content.Context

/** Lightweight local profiles. Catalog stays shared; UI preferences and parental mode are profile-aware. */
object ProfileStore {
    data class Profile(val id: String, val name: String, val kids: Boolean)

    private const val PREFS = "blofy_profiles"
    private const val KEY_ACTIVE = "active_profile"
    private val defaults = listOf(
        Profile("main", "الرئيسي", false),
        Profile("kids", "أطفال", true)
    )

    fun all(@Suppress("UNUSED_PARAMETER") context: Context): List<Profile> = defaults

    fun active(context: Context): Profile {
        val id = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY_ACTIVE, "main") ?: "main"
        return defaults.firstOrNull { it.id == id } ?: defaults.first()
    }

    fun select(context: Context, id: String) {
        if (defaults.none { it.id == id }) return
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(KEY_ACTIVE, id).apply()
    }

    fun isKids(context: Context): Boolean = active(context).kids
}
