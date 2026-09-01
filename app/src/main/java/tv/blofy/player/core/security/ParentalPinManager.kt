package tv.blofy.player.core.security

import android.content.Context

/**
 * Compatibility bridge for old v339 references.
 * PIN storage and parental locking are intentionally disabled.
 */
object ParentalPinManager {
    @Suppress("UNUSED_PARAMETER")
    fun hasPin(context: Context): Boolean = false

    @Suppress("UNUSED_PARAMETER")
    fun setPin(context: Context, pin: String): Boolean = false

    @Suppress("UNUSED_PARAMETER")
    fun verify(context: Context, pin: String): Boolean = true

    fun clear(context: Context) {
        context.getSharedPreferences("blofy_parental", Context.MODE_PRIVATE).edit().clear().apply()
    }
}
