package tv.blofy.player.core.identity

import android.content.Context
import tv.blofy.player.data.local.BlofyDatabase
import java.util.UUID

/**
 * Code-only APK bookkeeping. Credentials stay in the existing private Room
 * provider database, not in preferences, intents, logs, or UI.
 * The server is authoritative for expiry; do not trust Android TV wall clocks.
 */
object StreamCodeSession {
    private const val PREFS = "blofy_stream_code_session"
    private const val PROVIDER_ID_KEY = "provider_id"
    private const val ACTIVATED_AT = "activated_at"
    private const val EXPIRES_AT = "expires_at"
    const val HOST = "https://blofyplayer.com"
    private const val INSTALL_KEY = "code_installation_key"

    // Generated BEFORE first redemption; survives failed network responses
    // for this installation. Do not derive it from TV date, clock or IP.
    fun installationKey(context: Context): String {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        prefs.getString(INSTALL_KEY,null)?.takeIf {
            it.matches(Regex("[a-f0-9]{64}"))
        }?.let { return it }
        val random=ByteArray(32)
        java.security.SecureRandom().nextBytes(random)
        val key=random.joinToString("") { "%02x".format(it.toInt() and 0xff) }
        check(prefs.edit().putString(INSTALL_KEY,key).commit()) {
            "تعذر حفظ تعريف التفعيل على الجهاز"
        }
        return key
    }
    val providerId: String = UUID.nameUUIDFromBytes("blofy-stream-code-provider-v1".toByteArray()).toString()

    fun isClaimed(context: Context): Boolean =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .getString(PROVIDER_ID_KEY, null) == providerId

    fun save(context: Context, activatedAt: Long, expiresAt: Long) {
        check(context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putString(PROVIDER_ID_KEY, providerId)
            .putLong(ACTIVATED_AT, activatedAt)
            .putLong(EXPIRES_AT, expiresAt)
            .commit()) { "تعذر حفظ الاشتراك على الجهاز" }
    }

    fun clearClaim(context: Context) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit().remove(PROVIDER_ID_KEY).apply()
    }

    suspend fun hasSavedProvider(context: Context): Boolean =
        isClaimed(context) &&
            BlofyDatabase.get(context.applicationContext).dao().provider(providerId) != null
}
