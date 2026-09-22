package tv.blofy.player.core.storage

import org.junit.Assert.assertEquals
import org.junit.Test
import java.security.MessageDigest
import java.util.Locale

class StableHashTest {
    @Test fun existingArtworkPathsRemainIdenticalAcrossLocalesAndUnicodeUrls() {
        val original = Locale.getDefault()
        try {
            for (locale in listOf(Locale.US, Locale.forLanguageTag("ar-SA"), Locale.forLanguageTag("tr-TR"))) {
                Locale.setDefault(locale)
                for (value in listOf("", "https://example.test/صورة.jpg", "https://example.test/a?x=%20&n=42", "movie@640") +
                    (0..255).map { "https://example.test/$it" }) {
                    val legacy = MessageDigest.getInstance("SHA-256").digest(value.toByteArray(Charsets.UTF_8))
                        .joinToString("") { "%02x".format(it) }
                    assertEquals(legacy, StableHash.sha256(value))
                }
            }
        } finally { Locale.setDefault(original) }
    }
}
