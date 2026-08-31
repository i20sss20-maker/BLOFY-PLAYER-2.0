package tv.blofy.player.core.security

import android.content.Context
import java.security.MessageDigest

object ParentalPinManager {
    private const val PREFS = "blofy_parental"
    private const val KEY_PIN = "pin_hash"

    fun hasPin(context: Context): Boolean =
        !context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY_PIN, null).isNullOrBlank()

    fun setPin(context: Context, pin: String): Boolean {
        if (!pin.matches(Regex("\\d{4,6}"))) return false
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit().putString(KEY_PIN, hash(pin)).apply()
        return true
    }

    fun verify(context: Context, pin: String): Boolean {
        val stored = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY_PIN, null) ?: return false
        return stored == hash(pin)
    }

    fun clear(context: Context) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().remove(KEY_PIN).apply()
    }

    private fun hash(value: String): String =
        MessageDigest.getInstance("SHA-256").digest(value.toByteArray()).joinToString("") { "%02x".format(it) }
}
