package tv.blofy.player.core.security

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Test
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.PBEKeySpec

class PinKeyDerivationTest {
    @Test fun compatibilityImplementationMatchesIndependentSha256Vectors() {
        val vectors = mapOf(
            1 to "120fb6cffcf8b32c43e7225256c4f837a86548c92ccc35480805987cb70be17b",
            2 to "ae4d0c95af6b46d32d0adff928f06dd02a303f8ef3c251dfd6e2d85a95474c43",
            4096 to "c5e478d59288c841aa530db6845c4c8d962893a001ce4e11a4963873aa98134a",
        )
        vectors.forEach { (iterations, expected) ->
            val actual = PinKeyDerivation.deriveCompat("password", "salt".toByteArray(), iterations)
            assertEquals(expected, actual.joinToString("") { "%02x".format(it) })
        }
    }

    @Test fun oldAndroidPathMatchesCurrentPinRecordsIncludingArabicDigits() {
        val salt = "blofy-pin-salt-01".toByteArray()
        for (pin in listOf("1234", "١٢٣٤", "")) {
            val spec = PBEKeySpec(pin.toCharArray(), salt, 120_000, 256)
            val expected = SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(spec).encoded
            assertArrayEquals(expected, PinKeyDerivation.deriveCompat(pin, salt, 120_000))
        }
    }
}
