package tv.blofy.player.core.identity

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import org.json.JSONObject
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Independent encrypted external-provider profile. Never stores a plaintext
 * password or code in Room, nor overwrites the legacy BLOFY session.
 */
object ExternalStreamConnectStore {
    private const val PREFS = "blofy_connect_profile"
    private const val SEALED = "sealed_v1"
    private const val ALIAS = "blofy-connect-profile-v1"

    @Synchronized private fun key(create: Boolean): SecretKey? {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey(ALIAS, null) as? SecretKey)?.let { return it }
        if (!create) return null
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
            .apply {
                init(KeyGenParameterSpec.Builder(ALIAS,
                    KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                    .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                    .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                    .setKeySize(256).build())
            }.generateKey()
    }
    private fun prefs(context: Context) =
        context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun save(context: Context, credentials: ExternalStreamConnectClient.Credentials) {
        val plain = JSONObject().put("host", credentials.host.toString())
            .put("username", credentials.username).put("password", credentials.password)
            .toString().toByteArray(Charsets.UTF_8)
        try {
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.ENCRYPT_MODE, checkNotNull(key(true)))
            cipher.updateAAD(ALIAS.toByteArray(Charsets.UTF_8))
            val sealed = Base64.encodeToString(cipher.iv + cipher.doFinal(plain), Base64.NO_WRAP)
            check(prefs(context).edit().putString(SEALED, sealed).commit()) {
                "تعذر حفظ اشتراك CONNECT بصورة آمنة"
            }
        } finally { plain.fill(0) }
    }

    fun load(context: Context): ExternalStreamConnectClient.Credentials? {
        val value = prefs(context).getString(SEALED, null) ?: return null
        return runCatching {
            val bytes = Base64.decode(value, Base64.NO_WRAP)
            require(bytes.size in 29..4096)
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.DECRYPT_MODE, checkNotNull(key(false)),
                GCMParameterSpec(128, bytes.copyOfRange(0, 12)))
            cipher.updateAAD(ALIAS.toByteArray(Charsets.UTF_8))
            val plain = cipher.doFinal(bytes.copyOfRange(12, bytes.size))
            try {
                val json = JSONObject(String(plain, Charsets.UTF_8))
                val host = checkNotNull(ExternalStreamConnectClient.parseHost(json.getString("host")))
                val username = json.getString("username")
                val password = json.getString("password")
                require(username.length in 1..256 && password.length in 1..256 &&
                    (username + password).none { it.code < 32 || it.code == 127 })
                ExternalStreamConnectClient.Credentials(host, username, password)
            } finally { plain.fill(0) }
        }.getOrNull()
    }

    fun clear(context: Context) {
        check(prefs(context).edit().remove(SEALED).commit()) {
            "تعذر حذف اشتراك CONNECT"
        }
        runCatching {
            KeyStore.getInstance("AndroidKeyStore").apply { load(null); deleteEntry(ALIAS) }
        }
    }
}
