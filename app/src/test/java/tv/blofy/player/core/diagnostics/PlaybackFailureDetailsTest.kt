package tv.blofy.player.core.diagnostics

import android.app.Application
import androidx.annotation.OptIn
import androidx.media3.common.Format
import androidx.media3.common.PlaybackException
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.ExoPlaybackException
import androidx.media3.exoplayer.ExoTimeoutException
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import retrofit2.HttpException
import retrofit2.Response
import java.io.IOException
import java.net.SocketTimeoutException

@OptIn(markerClass = [UnstableApi::class])
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [23, 28], application = Application::class)
class PlaybackFailureDetailsTest {
    @Test fun releaseAndSurfaceTimeoutsRemainDistinguishableAfterSanitizing() {
        for ((operation, name) in listOf(ExoTimeoutException.TIMEOUT_OPERATION_RELEASE to "release",
            ExoTimeoutException.TIMEOUT_OPERATION_DETACH_SURFACE to "detach_surface")) {
            val error = ExoPlaybackException.createForUnexpected(ExoTimeoutException(operation), PlaybackException.ERROR_CODE_TIMEOUT)
            val safe = DiagnosticsSanitizer.sanitizeMessage(PlaybackFailureDetails.describe(error, "release"))!!
            assertTrue(safe.contains("timeout=$name"))
            assertTrue(safe.contains("ExoTimeoutException"))
            assertTrue(safe.contains("sdk="))
        }
    }

    @Test fun httpStatusSurvivesButResponseBodyAndCredentialsNeverEnterDiagnostics() {
        val error = HttpException(Response.error<Any>(458, "username=private-user&password=private-pass".toResponseBody()))
        val safe = PlaybackFailureDetails.describe(error, "episode_catalog")
        assertTrue(safe.contains("http=458"))
        assertEquals("ERROR_CODE_IO_BAD_HTTP_STATUS", PlaybackFailureDetails.requestErrorCode(error))
        assertFalse(safe.contains("private"))
    }

    @Test fun nestedTimeoutAndVideoProfileAreRecordedWithoutRawExceptionMessages() {
        val error = IOException("https://hidden.example/movie/private-user/private-pass/1.mkv", SocketTimeoutException("secret"))
        val format = Format.Builder().setSampleMimeType("video/hevc").setCodecs("hvc1.2.4.L150.90")
            .setWidth(3840).setHeight(2160).build()
        val safe = DiagnosticsSanitizer.sanitizeMessage(PlaybackFailureDetails.describe(error, "playback", format))!!
        assertTrue(safe.contains("size=3840x2160"))
        assertTrue(safe.contains("codec=hvc1_2_4_L150_90"))
        assertTrue(safe.contains("SocketTimeoutException"))
        assertFalse(safe.contains("private"))
        assertFalse(safe.contains("secret"))
        assertFalse(safe.contains("hidden.example"))
        assertEquals("ERROR_CODE_IO_NETWORK_CONNECTION_TIMEOUT", PlaybackFailureDetails.requestErrorCode(error))
    }

    @Test fun previewIsReportedAsLiveInsteadOfUnknown() {
        assertEquals("live", DiagnosticsSanitizer.sanitizeContentKind("live_preview"))
    }
}
