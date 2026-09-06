package tv.blofy.player.ui.common

import android.app.Application
import android.content.res.Configuration
import android.os.LocaleList
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.util.Locale

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [23, 24, 35], application = Application::class)
class LegacyScreenLocalizationApiCompatibilityTest {
    private val lifecycle = LegacyScreenLocalizationLifecycle()

    private fun configuration(tag: String) = Configuration().apply {
        setLocale(Locale.forLanguageTag(tag))
    }

    @Test fun arabicRegionalLocalesRemainArabicOnEverySupportedApiPath() {
        listOf("ar", "ar-SA", "ar-EG").forEach { tag ->
            assertTrue(tag, lifecycle.isArabic(configuration(tag)))
        }
    }

    @Test fun englishRegionalLocalesAreNotArabic() {
        listOf("en", "en-US", "en-GB").forEach { tag ->
            assertFalse(tag, lifecycle.isArabic(configuration(tag)))
        }
    }

    @Test fun otherRightToLeftLanguagesAreNotMistakenForArabic() {
        listOf("fa-IR", "he-IL", "ur-PK").forEach { tag ->
            assertFalse(tag, lifecycle.isArabic(configuration(tag)))
        }
    }

    @Test fun activityConfigurationTakesPrecedenceOverProcessDefault() {
        // Do not mutate the JVM default locale; other tests share this process.
        val defaultIsArabic = Locale.getDefault().language.equals("ar", ignoreCase = true)
        val appConfiguration = configuration(if (defaultIsArabic) "en-US" else "ar-SA")
        assertEquals(!defaultIsArabic, lifecycle.isArabic(appConfiguration))
    }

    @Test
    @Config(sdk = [24, 35])
    fun onlyThePrimaryAppLocaleControlsArabicLabels() {
        val english = Locale.forLanguageTag("en-US")
        val arabic = Locale.forLanguageTag("ar-SA")
        val appConfiguration = Configuration()
        appConfiguration.setLocales(LocaleList(english, arabic))
        assertFalse(lifecycle.isArabic(appConfiguration))
        appConfiguration.setLocales(LocaleList(arabic, english))
        assertTrue(lifecycle.isArabic(appConfiguration))
    }

    @Test
    @Config(sdk = [24, 35])
    fun emptyLocaleListDoesNotCrashOrEnableArabic() {
        val appConfiguration = Configuration().apply { setLocales(LocaleList()) }
        assertFalse(lifecycle.isArabic(appConfiguration))
    }
}
