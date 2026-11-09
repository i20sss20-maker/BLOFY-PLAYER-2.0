package tv.blofy.player.ui.login

import android.content.res.Configuration
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import tv.blofy.player.BuildConfig
import tv.blofy.player.R
import java.util.Locale

/** Independent STREAM language resources must work on the affected Android 9 devices. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28])
class StreamArabicLanguageTest {
    private fun localized(tag: String): android.content.Context {
        val app = RuntimeEnvironment.getApplication()
        val config = Configuration(app.resources.configuration)
        config.setLocale(Locale.forLanguageTag(tag))
        return app.createConfigurationContext(config)
    }

    @Test fun streamArabicAndEnglishLoginStringsAreDistinct() {
        assumeTrue(BuildConfig.CODE_ONLY_LOGIN)
        val arabic = localized("ar")
        val english = localized("en")
        assertEquals("أدخل كود اشتراكك", arabic.getString(R.string.stream_ui_code_title))
        assertEquals("Enter your subscription code", english.getString(R.string.stream_ui_code_title))
        assertEquals("مختار لك", arabic.getString(R.string.stream_ui_featured))
        assertEquals("FEATURED FOR YOU", english.getString(R.string.stream_ui_featured))
    }

    @Test fun streamLoadingAndSubscriptionStatusTranslate() {
        assumeTrue(BuildConfig.CODE_ONLY_LOGIN)
        val arabic = localized("ar")
        val english = localized("en")
        assertTrue(arabic.getString(R.string.stream_ui_items_count, "الأفلام", "1,000").contains("عنصر"))
        assertTrue(english.getString(R.string.stream_ui_items_count, "Movies", "1,000").contains("items"))
        assertTrue(arabic.getString(R.string.stream_ui_subscription_details, "1 يوم", "10/11/2026").contains("الحالة"))
        assertTrue(english.getString(R.string.stream_ui_subscription_details, "1 day", "10/11/2026").contains("Status"))
    }
}
