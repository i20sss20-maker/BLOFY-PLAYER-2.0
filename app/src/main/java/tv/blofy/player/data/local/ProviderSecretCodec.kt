package tv.blofy.player.data.local

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.nio.ByteBuffer
import java.security.GeneralSecurityException
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** Storage-only encryption. The Room schema and plaintext provider API stay unchanged. */
internal object ProviderSecretCodec {
    private const val KEY_ALIAS = "blofy_provider_credentials_v1"
    private val keys = ProviderSecretKeyAccess(
        read = {
            val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
            store.getKey(KEY_ALIAS, null) as? SecretKey
        },
        create = {
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
            generator.generateKey()
        },
    )
    private val cipher = ProviderSecretCipher(keys::get)

    fun seal(provider: ProviderEntity): ProviderEntity = cipher.seal(provider)
    fun sealForUpdate(provider: ProviderEntity, stored: ProviderEntity?): ProviderEntity = cipher.sealForUpdate(provider, stored)
    fun open(provider: ProviderEntity): ProviderEntity = cipher.open(provider)
    fun needsSealing(provider: ProviderEntity): Boolean = cipher.needsSealing(provider)
    fun isSealed(value: String): Boolean = value.startsWith(PROVIDER_SECRET_PREFIX)
}

/** One process-wide owner prevents simultaneous first writes from replacing the same alias. */
internal class ProviderSecretKeyAccess(
    private val read: () -> SecretKey?,
    private val create: () -> SecretKey,
) {
    @Synchronized
    fun get(createIfMissing: Boolean): SecretKey {
        read()?.let { return it }
        // A missing decryption key is not permission to generate a replacement. Preserve stored
        // ciphertext so temporary Keystore failures can recover; never delete/reset the alias.
        if (!createIfMissing) throw GeneralSecurityException("Provider encryption key unavailable")
        return create()
    }
}

/** Injectable key access lets regression tests exercise real AES-GCM without a hardware Keystore. */
internal class ProviderSecretCipher(private val key: (Boolean) -> SecretKey) {
    private data class Fields(val baseUrl: String, val username: String, val password: String) {
        fun applyTo(provider: ProviderEntity) = provider.copy(baseUrl = baseUrl, username = username, password = password)
    }
    // Cache successful reads by exact ciphertext, never by provider ID. Hardware Keystore can be
    // slow on TVs; category/navigation reads must not repeat three AES operations per emission.
    // Failed reads remain retryable and changed credentials cannot reuse an older plaintext row.
    private val opened = object : LinkedHashMap<Fields, Fields>(16, .75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<Fields, Fields>?) = size > 16
    }
    fun needsSealing(provider: ProviderEntity): Boolean =
        needsSealing(provider.baseUrl) || needsSealing(provider.username) || needsSealing(provider.password)

    fun sealForUpdate(provider: ProviderEntity, stored: ProviderEntity?): ProviderEntity {
        if (stored == null) return seal(provider)
        // Failed reads expose empty values to prevent ciphertext reaching a provider. A later
        // selection/metadata save must not write that projection back over the recoverable secret,
        // even if Keystore has recovered between the read and this write. Xtream fields cannot be
        // explicitly cleared in the editor; a deliberate change to M3U may clear its credentials.
        fun keepCiphertext(value: String, previous: String): String =
            if (value.isEmpty() && isSealed(previous)) previous else value
        val sameType = provider.providerType == stored.providerType
        return seal(provider.copy(
            baseUrl = keepCiphertext(provider.baseUrl, stored.baseUrl),
            username = if (sameType) keepCiphertext(provider.username, stored.username) else provider.username,
            password = if (sameType) keepCiphertext(provider.password, stored.password) else provider.password,
        ))
    }

    fun seal(provider: ProviderEntity): ProviderEntity {
        if (!needsSealing(provider)) return provider
        return try {
            val fields = listOf(provider.baseUrl, provider.username, provider.password)
            // A partially migrated row already depends on an existing key. Never create a new key
            // to encrypt just its remaining fields when that existing key cannot be read.
            val secretKey = key(fields.none(::isSealed))
            provider.copy(
                baseUrl = sealValue(provider.baseUrl, secretKey),
                username = sealValue(provider.username, secretKey),
                password = sealValue(provider.password, secretKey),
            )
        } catch (_: Exception) {
            // Compatibility policy: keep the *entire original row* on defective TV firmware.
            // This is a plaintext fallback, not successful encryption. Do not erase credentials
            // or publish a new partially encrypted row when any encryption operation fails.
            provider
        }
    }

    fun open(provider: ProviderEntity): ProviderEntity {
        val fields = listOf(provider.baseUrl, provider.username, provider.password)
        if (fields.none(::isSealed)) return provider
        val stored = Fields(provider.baseUrl, provider.username, provider.password)
        synchronized(opened) { opened[stored] }?.let { return it.applyTo(provider) }
        return try {
            val secretKey = key(false)
            val result = provider.copy(
                baseUrl = openValue(provider.baseUrl, secretKey),
                username = openValue(provider.username, secretKey),
                password = openValue(provider.password, secretKey),
            )
            synchronized(opened) { opened[stored] = Fields(result.baseUrl, result.username, result.password) }
            result
        } catch (_: Exception) {
            // This is only the returned API projection; the stored row is never mutated.
            // Do not send ciphertext or partially decrypted credentials to a provider.
            provider.copy(
                baseUrl = if (isSealed(provider.baseUrl)) "" else provider.baseUrl,
                username = if (isSealed(provider.username)) "" else provider.username,
                password = if (isSealed(provider.password)) "" else provider.password,
            )
        }
    }

    private fun isSealed(value: String): Boolean = value.startsWith(PROVIDER_SECRET_PREFIX)
    private fun needsSealing(value: String): Boolean = value.isNotEmpty() && !isSealed(value)

    private fun sealValue(value: String, secretKey: SecretKey): String {
        if (!needsSealing(value)) return value
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, secretKey)
        val iv = cipher.iv
        val encrypted = cipher.doFinal(value.toByteArray(Charsets.UTF_8))
        require(iv.size in 8..32)
        val packed = ByteBuffer.allocate(1 + iv.size + encrypted.size)
            .put(iv.size.toByte()).put(iv).put(encrypted).array()
        return PROVIDER_SECRET_PREFIX + Base64.encodeToString(packed, Base64.NO_WRAP)
    }

    private fun openValue(value: String, secretKey: SecretKey): String {
        if (!isSealed(value)) return value
        val packed = Base64.decode(value.removePrefix(PROVIDER_SECRET_PREFIX), Base64.DEFAULT)
        require(packed.isNotEmpty())
        val ivSize = packed[0].toInt() and 0xff
        require(ivSize in 8..32 && packed.size >= 1 + ivSize + 16)
        val iv = packed.copyOfRange(1, 1 + ivSize)
        val encrypted = packed.copyOfRange(1 + ivSize, packed.size)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, secretKey, GCMParameterSpec(128, iv))
        return cipher.doFinal(encrypted).toString(Charsets.UTF_8)
    }
}

private const val PROVIDER_SECRET_PREFIX = "BLOFYENC1:"
