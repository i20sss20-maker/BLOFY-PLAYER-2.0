package tv.blofy.player.core.identity

import android.content.Context
import android.provider.Settings
import java.security.MessageDigest

/** A disclosed, app-scoped trial signal. Never replaces the random login ID or its PIN. */
object TrialIdentity {
    fun scope(context: Context): String? = runCatching {
        digest(Settings.Secure.getString(context.contentResolver, Settings.Secure.ANDROID_ID))
    }.getOrNull()

    internal fun digest(value: String?): String? {
        val id = value?.lowercase()?.takeIf { it.matches(Regex("[a-f0-9]{16}")) && it != "0000000000000000" } ?: return null
        return MessageDigest.getInstance("SHA-256")
            .digest("blofy-trial-scope-v1:$id".toByteArray(Charsets.UTF_8))
            .joinToString("") { "%02x".format(it.toInt() and 0xff) }
    }
}
