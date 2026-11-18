package tv.blofy.player.core.diagnostics

import android.app.Application
import android.content.res.Configuration
import java.util.Locale
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import tv.blofy.player.R

/** Customer-facing copy must never reveal internal transport/decoder codes. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28], application = Application::class)
class StreamCustomerTextTest {
    private val diagnostics = listOf(
        R.string.stream_ui_cert_error,
        R.string.stream_ui_dns_error,
        R.string.stream_ui_timeout_error,
        R.string.stream_ui_network_error,
        R.string.stream_ui_unauthorized_error,
        R.string.stream_ui_content_missing_error,
        R.string.stream_ui_rate_limited_error,
        R.string.stream_ui_server_error,
        R.string.stream_ui_decoder_error,
        R.string.stream_ui_generic_error,
        R.string.stream_downloads_note,
        R.string.stream_downloads_unavailable,
        R.string.stream_downloads_failure_generic,
        R.string.stream_downloads_failure_http_access,
        R.string.stream_downloads_failure_http_missing,
        R.string.stream_downloads_failure_http_busy,
        R.string.stream_downloads_failure_http_server
    )
    private val technical = Regex(
        """(?:\b(?:HTTP|HTTPS|SDK|Media3|VLC|FFmpeg|DRM|HLS|DASH|DNS|codec|decoder|401|403|404|410|429|502|503|5xx|MP4|MKV|WEBM|MOV|M4V)\b|محرك|ترميز|رمز [0-9]+)""",
        RegexOption.IGNORE_CASE
    )

    @Test fun errorAndDownloadMessagesStaySimpleInBothLanguages() {
        for (language in listOf("ar", "en")) {
            val base = RuntimeEnvironment.getApplication<Application>()
            val configuration = Configuration(base.resources.configuration).apply {
                setLocale(Locale.forLanguageTag(language))
            }
            val localized = base.createConfigurationContext(configuration)
            for (id in diagnostics) {
                val copy = localized.getString(id)
                assertTrue("Missing customer text for $language: $id", copy.isNotBlank())
                assertFalse("Technical text visible ($language): $copy", technical.containsMatchIn(copy))
                assertFalse("Raw URL visible: $copy", "://" in copy)
            }
        }
    }
}
