package tv.blofy.player.data.local

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.nio.ByteBuffer
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Protects provider endpoints and credentials while they are stored in Room.
 *
 * The database schema deliberately stays unchanged so existing installations can upgrade in place.
 * Legacy plaintext rows remain readable; every subsequent provider write is sealed with an
 * installation-local AES key held by Android Keystore. Broken/absent Keystore implementations on
 * very old TV boxes fail soft to legacy plaintext rather than making a working playlist unusable.
 */
internal object ProviderSecretCodec {
    private const val KEY_ALIAS = "blofy_provider_credentials_v1"
    private const val PREFIX = "BLOFYENC1:"
    private const val TRANSFORMATION = "AES/GCM/NoPadding"
    private const val TAG_BITS = 128

    fun seal(provider: ProviderEntity): ProviderEntity = provider.copy(
        baseUrl = seal(provider.baseUrl),
        username = seal(provider.username),
        password = seal(provider.password),
    )

    fun open(provider: ProviderEntity): ProviderEntity = provider.copy(
        baseUrl = open(provider.baseUrl),
        username = open(provider.username),
        password = open(provider.password),
    )

    fun needsSealing(provider: ProviderEntity): Boolean =
        needsSealing(provider.baseUrl) || needsSealing(provider.username) || needsSealing(provider.password)

    fun isSealed(value: String): Boolean = value.startsWith(PREFIX)

    private fun needsSealing(value: String): Boolean = value.isNotEmpty() && !isSealed(value)

    private fun seal(value: String): String {
        if (value.isEmpty() || isSealed(value)) return value
        return runCatching {
            val cipher = Cipher.getInstance(TRANSFORMATION)
            cipher.init(Cipher.ENCRYPT_MODE, key())
            val iv = cipher.iv
            val encrypted = cipher.doFinal(value.toByteArray(Charsets.UTF_8))
            require(iv.size in 8..32)
            val packed = ByteBuffer.allocate(1 + iv.size + encrypted.size)
                .put(iv.size.toByte())
                .put(iv)
                .put(encrypted)
                .array()
            PREFIX + Base64.encodeToString(packed, Base64.NO_WRAP)
        }.getOrElse {
            // Some inexpensive Android TV firmware ships a damaged Keystore provider. Security
            // hardening must never turn that vendor bug into lost customer playlists.
            value
        }
    }

    private fun open(value: String): String {
        if (!isSealed(value)) return value
        return runCatching {
            val packed = Base64.decode(value.removePrefix(PREFIX), Base64.DEFAULT)
            require(packed.size > 1)
            val ivSize = packed[0].toInt() and 0xff
            require(ivSize in 8..32 && packed.size > 1 + ivSize)
            val iv = packed.copyOfRange(1, 1 + ivSize)
            val encrypted = packed.copyOfRange(1 + ivSize, packed.size)
            val cipher = Cipher.getInstance(TRANSFORMATION)
            cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(TAG_BITS, iv))
            cipher.doFinal(encrypted).toString(Charsets.UTF_8)
        }.getOrElse {
            // Never expose ciphertext as a usable host/password. Returning an empty value forces the
            // normal login/playlist recovery path instead of accidentally sending sealed material.
            ""
        }
    }

    private fun key(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey(KEY_ALIAS, null) as? SecretKey)?.let { return it }

        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        generator.init(
            KeyGenParameterSpec.Builder(
                KEY_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
            )
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setRandomizedEncryptionRequired(true)
                .build()
        )
        return generator.generateKey()
    }
}
