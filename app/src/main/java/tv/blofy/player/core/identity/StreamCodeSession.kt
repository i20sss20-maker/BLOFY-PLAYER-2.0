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

    suspend fun hasSavedProvider(context: Context): Boolean =
        isClaimed(context) &&
            BlofyDatabase.get(context.applicationContext).dao().provider(providerId) != null
}
