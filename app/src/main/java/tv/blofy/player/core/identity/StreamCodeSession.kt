package tv.blofy.player.core.identity

import android.content.Context
import tv.blofy.player.data.local.BlofyDatabase
import java.util.UUID
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

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
    private const val ENCRYPTED_TOKEN = "encrypted_bearer"
    private const val KEY_ALIAS = "blofy-stream-app-access-v1"
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

    private fun secretKey(): SecretKey {
        val store=KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey(KEY_ALIAS,null) as? SecretKey)?.let { return it }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES,"AndroidKeyStore")
            .apply {
                init(KeyGenParameterSpec.Builder(KEY_ALIAS,
                    KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                    .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                    .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                    .setKeySize(256).build())
            }.generateKey()
    }
    private fun encryptToken(value: String): String {
        val cipher=Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE,secretKey())
        val encrypted=cipher.doFinal(value.toByteArray(Charsets.UTF_8))
        return Base64.encodeToString(cipher.iv+encrypted,Base64.NO_WRAP)
    }
    fun token(context: Context): String? {
        val encrypted=context.getSharedPreferences(PREFS,Context.MODE_PRIVATE)
            .getString(ENCRYPTED_TOKEN,null)?:return null
        return runCatching {
            val payload=Base64.decode(encrypted,Base64.NO_WRAP)
            require(payload.size>28)
            val decipher=Cipher.getInstance("AES/GCM/NoPadding")
            decipher.init(Cipher.DECRYPT_MODE,secretKey(),
                GCMParameterSpec(128,payload.copyOfRange(0,12)))
            val plain=String(decipher.doFinal(payload.copyOfRange(12,payload.size)),Charsets.UTF_8)
            plain.takeIf { it.matches(Regex("v1\\.[0-9a-f-]{36}\\.[A-Za-z0-9_-]{43}")) }
        }.getOrNull()
    }
    fun authorization(context: Context): String? = token(context)?.let { "Bearer $it" }

    fun save(context: Context, accessToken: String, activatedAt: Long, expiresAt: Long) {
        require(accessToken.matches(Regex("v1\\.[0-9a-f-]{36}\\.[A-Za-z0-9_-]{43}")))
        val encrypted=encryptToken(accessToken)
        check(context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putString(PROVIDER_ID_KEY, providerId)
            .putString(ENCRYPTED_TOKEN, encrypted)
            .putLong(ACTIVATED_AT, activatedAt)
            .putLong(EXPIRES_AT, expiresAt)
            .commit()) { "تعذر حفظ الاشتراك على الجهاز" }
    }

    fun clearClaim(context: Context) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit().remove(PROVIDER_ID_KEY).remove(ENCRYPTED_TOKEN).apply()
    }

    suspend fun hasSavedProvider(context: Context): Boolean =
        isClaimed(context) &&
            BlofyDatabase.get(context.applicationContext).dao().provider(providerId) != null
}
