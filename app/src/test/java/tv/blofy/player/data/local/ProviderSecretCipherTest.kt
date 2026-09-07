package tv.blofy.player.data.local

import android.app.Application
import android.util.Base64
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.security.GeneralSecurityException
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import javax.crypto.Cipher
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28], application = Application::class)
class ProviderSecretCipherTest {
    private val aesKey = SecretKeySpec(ByteArray(32) { (it + 1).toByte() }, "AES")
    private val original = ProviderEntity(
        "secret-test", "Library", "https://example.test:8443/api?q=a%2Fb&lang=ar",
        "مستخدم + &", "p/+?&=🔒", updatedAt = 123L,
    )

    @Test fun plaintextReadDoesNotOpenTheKeystore() {
        val codec = ProviderSecretCipher { error("Key access was not expected") }
        assertEquals(original, codec.open(original))
    }

    @Test fun aesGcmRoundTripPreservesAllProviderFieldsAndUnicode() {
        val codec = ProviderSecretCipher { aesKey }
        val encrypted = codec.seal(original)
        assertTrue(encrypted.baseUrl.startsWith("BLOFYENC1:"))
        assertTrue(encrypted.username.startsWith("BLOFYENC1:"))
        assertTrue(encrypted.password.startsWith("BLOFYENC1:"))
        assertFalse(codec.needsSealing(encrypted))
        assertEquals(original, codec.open(encrypted))
    }

    @Test fun repeatedEncryptionUsesDifferentNonces() {
        val codec = ProviderSecretCipher { aesKey }
        val first = codec.seal(original)
        val second = codec.seal(original)
        assertNotEquals(first.baseUrl, second.baseUrl)
        assertNotEquals(first.password, second.password)
        assertEquals(codec.open(first), codec.open(second))
    }

    @Test fun alreadyEncryptedRecordIsNotDecryptedOrRewrittenDuringMigration() {
        val sealed = ProviderSecretCipher { aesKey }.seal(original)
        val offline = ProviderSecretCipher { error("Migration must not read a key") }
        assertEquals(sealed, offline.seal(sealed))
    }

    @Test fun partialMigrationWithUnavailableKeyPreservesTheExactStoredRecord() {
        val sealed = ProviderSecretCipher { aesKey }.seal(original)
        val mixed = original.copy(password = sealed.password)
        val requestedCreation = mutableListOf<Boolean>()
        val unavailable = ProviderSecretCipher { create ->
            requestedCreation += create
            throw GeneralSecurityException("temporarily unavailable")
        }
        assertEquals(mixed, unavailable.seal(mixed))
        assertEquals(listOf(false), requestedCreation)
        assertEquals(original, ProviderSecretCipher { aesKey }.open(mixed))
    }

    @Test fun partialMigrationOnlySealsRemainingPlaintextFields() {
        val codec = ProviderSecretCipher { aesKey }
        val oldPassword = codec.seal(original).password
        val migrated = codec.seal(original.copy(password = oldPassword))
        assertEquals(oldPassword, migrated.password)
        assertEquals(original, codec.open(migrated))
    }

    @Test fun failedEncryptionKeepsOriginalCredentialsInsteadOfPartialWrites() {
        val invalidKey = SecretKeySpec(ByteArray(15), "AES")
        assertEquals(original, ProviderSecretCipher { invalidKey }.seal(original))
    }

    @Test fun emptyM3uCredentialsStayEmpty() {
        val m3u = original.copy(username = "", password = "", providerType = "m3u")
        val codec = ProviderSecretCipher { aesKey }
        val sealed = codec.seal(m3u)
        assertEquals("", sealed.username)
        assertEquals("", sealed.password)
        assertEquals(m3u, codec.open(sealed))
    }

    @Test fun tamperingDoesNotExposeCiphertextOrPartiallyDecryptedCredentials() {
        val codec = ProviderSecretCipher { aesKey }
        val sealed = codec.seal(original)
        val bytes = Base64.decode(sealed.password.removePrefix("BLOFYENC1:"), Base64.DEFAULT)
        bytes[bytes.lastIndex] = (bytes.last().toInt() xor 1).toByte()
        val corrupt = sealed.copy(password = "BLOFYENC1:" + Base64.encodeToString(bytes, Base64.NO_WRAP))
        val opened = codec.open(corrupt)
        assertEquals("", opened.baseUrl)
        assertEquals("", opened.username)
        assertEquals("", opened.password)
        assertEquals(corrupt, codec.seal(corrupt))
    }

    @Test fun temporaryDecryptionFailureRecoversWithoutChangingStoredCiphertext() {
        val sealed = ProviderSecretCipher { aesKey }.seal(original)
        var available = false
        val codec = ProviderSecretCipher { create ->
            assertFalse("Decryption must not generate a new key", create)
            if (!available) throw GeneralSecurityException("temporarily unavailable")
            aesKey
        }
        assertEquals("", codec.open(sealed).baseUrl)
        available = true
        assertEquals(original, codec.open(sealed))
    }

    @Test fun savingFailedReadAfterKeyRecoversPreservesCredentials() {
        var available = true
        val codec = ProviderSecretCipher {
            if (!available) throw GeneralSecurityException("temporarily unavailable")
            aesKey
        }
        val sealed = codec.seal(original)
        available = false
        val projection = codec.open(sealed).copy(name = "Renamed", enabled = false)
        assertEquals("", projection.baseUrl)
        available = true
        val saved = codec.sealForUpdate(projection, sealed)
        assertEquals(original.copy(name = "Renamed", enabled = false), codec.open(saved))
    }

    @Test fun explicitCompleteReplacementAndM3uConversionRemainPossible() {
        val codec = ProviderSecretCipher { aesKey }
        val stored = codec.seal(original)
        val replacement = original.copy(baseUrl = "https://new.example.test", username = "new", password = "new-pass")
        assertEquals(replacement, codec.open(codec.sealForUpdate(replacement, stored)))
        val m3u = original.copy(providerType = "m3u", baseUrl = "https://example.test/list.m3u", username = "", password = "")
        assertEquals(m3u, codec.open(codec.sealForUpdate(m3u, stored)))
    }

    @Test fun existingVersionOneEnvelopeRemainsReadable() {
        // Encode the old wire format independently of the production serializer.
        val iv = ByteArray(12) { it.toByte() }
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, aesKey, GCMParameterSpec(128, iv))
        val packed = byteArrayOf(12) + iv + cipher.doFinal(original.password.toByteArray(Charsets.UTF_8))
        val legacy = original.copy(password = "BLOFYENC1:" + Base64.encodeToString(packed, Base64.NO_WRAP))
        assertEquals(original, ProviderSecretCipher { aesKey }.open(legacy))
    }

    @Test fun absentDecryptionKeyNeverInvokesKeyGeneration() {
        val creates = AtomicInteger()
        val access = ProviderSecretKeyAccess(read = { null }, create = { creates.incrementAndGet(); aesKey })
        try {
            access.get(false)
            fail("Expected a missing-key failure")
        } catch (_: GeneralSecurityException) { }
        assertEquals(0, creates.get())
    }

    @Test fun simultaneousFirstWritesCreateExactlyOneKey() {
        var stored: SecretKey? = null
        val creates = AtomicInteger()
        val access = ProviderSecretKeyAccess(
            read = { stored },
            create = { creates.incrementAndGet(); Thread.sleep(15); aesKey.also { stored = it } },
        )
        val executor = Executors.newFixedThreadPool(8)
        val start = CountDownLatch(1)
        try {
            val results = (1..32).map { executor.submit<SecretKey> { start.await(); access.get(true) } }
            start.countDown()
            results.forEach { assertSame(aesKey, it.get(5, TimeUnit.SECONDS)) }
            assertEquals(1, creates.get())
        } finally {
            executor.shutdownNow()
        }
    }
}
