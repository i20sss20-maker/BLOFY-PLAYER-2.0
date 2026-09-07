package tv.blofy.player.core.security

import java.security.NoSuchAlgorithmException
import javax.crypto.Mac
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.PBEKeySpec
import javax.crypto.spec.SecretKeySpec

/** Same PBKDF2-HMAC-SHA256 record on every supported Android version, including API 23–25. */
internal object PinKeyDerivation {
    fun derive(value: String, salt: ByteArray, iterations: Int): ByteArray {
        val spec = PBEKeySpec(value.toCharArray(), salt, iterations, 256)
        return try {
            try {
                SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(spec).encoded
            } catch (_: NoSuchAlgorithmException) {
                // Android only guarantees this SecretKeyFactory from API 26. HmacSHA256 Mac is
                // available on older supported releases; do not downgrade stored PINs to SHA-1.
                deriveCompat(value, salt, iterations)
            }
        } finally {
            spec.clearPassword()
        }
    }

    internal fun deriveCompat(value: String, salt: ByteArray, iterations: Int): ByteArray {
        require(iterations in 1..500_000 && salt.isNotEmpty())
        val password = value.toByteArray(Charsets.UTF_8)
        // Empty HMAC keys and a single zero byte are equivalent after HMAC block padding.
        val mac = Mac.getInstance("HmacSHA256")
        try {
            mac.init(SecretKeySpec(if (password.isEmpty()) byteArrayOf(0) else password, "HmacSHA256"))
            // A 256-bit output needs only block 1: U1 = PRF(password, salt || INT_32_BE(1)).
            var u = mac.doFinal(salt + byteArrayOf(0, 0, 0, 1))
            val derived = u.copyOf()
            repeat(iterations - 1) {
                val next = mac.doFinal(u)
                u.fill(0)
                u = next
                for (i in derived.indices) derived[i] = (derived[i].toInt() xor u[i].toInt()).toByte()
            }
            u.fill(0)
            return derived
        } finally {
            password.fill(0)
        }
    }
}
