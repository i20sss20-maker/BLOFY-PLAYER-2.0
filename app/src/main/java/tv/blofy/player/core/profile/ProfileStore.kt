package tv.blofy.player.core.profile

import android.content.Context
import java.security.MessageDigest

/** Local BLOFY profiles. Catalog stays shared; active profile and kids PIN stay on-device. */
object ProfileStore {
    data class Profile(val id: String, val name: String, val kids: Boolean, val pinHash: String?)

    private const val PREFS = "blofy_profiles"
    private const val KEY_ACTIVE = "active_profile"
    private val defaults = listOf(
        Profile("main", "الرئيسي", false, null),
        Profile("kids", "أطفال", true, null)
    )

    fun all(context: Context): List<Profile> = defaults.map { base ->
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        base.copy(pinHash = prefs.getString("pin_${base.id}", null))
    }

    fun active(context: Context): Profile {
        val id = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY_ACTIVE, "main") ?: "main"
        return all(context).firstOrNull { it.id == id } ?: all(context).first()
    }

    fun select(context: Context, id: String) {
        if (defaults.none { it.id == id }) return
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(KEY_ACTIVE, id).apply()
    }

    fun setPin(context: Context, id: String, pin: String?) {
        if (defaults.none { it.id == id }) return
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putString("pin_$id", pin?.takeIf { it.isNotBlank() }?.let(::hash))
            .apply()
    }

    fun verifyPin(profile: Profile, pin: String): Boolean = profile.pinHash == null || profile.pinHash == hash(pin)
    fun isKids(context: Context): Boolean = active(context).kids

    private fun hash(value: String): String = MessageDigest.getInstance("SHA-256")
        .digest(value.toByteArray(Charsets.UTF_8))
        .joinToString("") { "%02x".format(it) }
}
