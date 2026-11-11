package tv.blofy.player.core.diagnostics

import android.app.Application
import android.os.SystemClock
import org.junit.After
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.shadows.ShadowSystemClock
import java.time.Duration

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28], application = Application::class)
class PlaybackQualityAssessmentTest {
    @After fun clear() = PlaybackDiagnostics.clear()

    private fun metric(
        firstFrameMs: Long? = 2500, code: String? = null,
        details: String? = null, rebufferCount: Int = 0, bufferMs: Long = 0
    ) = PlaybackMetric(
        providerKey = "provider-unknown", contentKind = "series",
        url = "https://redacted.invalid/series/***.mkv",
        startedAtElapsedMs = 1000, firstFrameElapsedMs = firstFrameMs,
        rebufferCount = rebufferCount, rebufferDurationMs = bufferMs,
        errorCode = code, errorMessage = details
    )

    @Test fun distinguishesAbsentSeriesEpisodeFromConnectionFailure() {
        val missing = PlaybackQualityAssessment.classify(metric(null,
            "ERROR_CODE_IO_BAD_HTTP_STATUS", "phase=playback;http=404;cause=InvalidResponseCodeException"))
        assertEquals(PlaybackQualityAssessment.Cause.CONTENT_MISSING, missing.cause)
        assertTrue(missing.adviceAr.contains("الحلقة"))

        val denied = PlaybackQualityAssessment.classify(metric(null,
            "ERROR_CODE_IO_BAD_HTTP_STATUS", "phase=playback;http=403;cause=InvalidResponseCodeException"))
        assertEquals(PlaybackQualityAssessment.Cause.ACCESS_DENIED, denied.cause)

        val server = PlaybackQualityAssessment.classify(metric(null,
            "ERROR_CODE_IO_BAD_HTTP_STATUS", "phase=playback;http=502;cause=InvalidResponseCodeException"))
        assertEquals(PlaybackQualityAssessment.Cause.SOURCE_RESPONSE, server.cause)
        val limited = PlaybackQualityAssessment.classify(metric(null,
            "ERROR_CODE_IO_BAD_HTTP_STATUS", "phase=playback;http=429;cause=InvalidResponseCodeException"))
        assertEquals(PlaybackQualityAssessment.Cause.SOURCE_LIMIT, limited.cause)
    }

    @Test fun slowFirstFrameAndRebufferAreIndependentObservedMetrics() {
        assertEquals(PlaybackQualityAssessment.Cause.SLOW_START,
            PlaybackQualityAssessment.classify(metric(11_001L)).cause)
        assertEquals(PlaybackQualityAssessment.Cause.REBUFFERING,
            PlaybackQualityAssessment.classify(metric(rebufferCount=2,bufferMs=9000)).cause)
        assertEquals(PlaybackQualityAssessment.Cause.PLAYING,
            PlaybackQualityAssessment.classify(metric()).cause)
        assertEquals(PlaybackQualityAssessment.Cause.NOT_READY,
            PlaybackQualityAssessment.classify(metric(null)).cause)
        assertEquals(2500L, PlaybackQualityAssessment.medianStartMs(listOf(
            metric(firstFrameMs = 1500), metric(firstFrameMs=2500), metric(firstFrameMs=5500)
        )))
    }

    @Test fun diagnosticLabelsNeverIncludeProviderOrSecretEndpoint() {
        val problem=PlaybackQualityAssessment.classify(metric(null,
            "ERROR_CODE_IO_BAD_HTTP_STATUS","phase=playback;http=404;cause=private-server"))
        assertFalse(problem.titleAr.contains("private-server"))
        assertFalse(problem.adviceAr.contains("private-server"))
    }

    @Test fun audioTrackSymptomsRequireEvidenceNotJustVideoWithNoSound() {
        assertEquals(PlaybackQualityAssessment.Cause.AUDIO_CODEC,
            PlaybackQualityAssessment.classify(metric(), StreamAudioHealth.State.UNSUPPORTED_AUDIO_CODEC).cause)
        assertEquals(PlaybackQualityAssessment.Cause.AUDIO_SELECTION,
            PlaybackQualityAssessment.classify(metric(), StreamAudioHealth.State.SUPPORTED_NOT_SELECTED).cause)
        assertEquals(PlaybackQualityAssessment.Cause.PLAYING,
            PlaybackQualityAssessment.classify(metric(), StreamAudioHealth.State.AUDIO_TRACK_SELECTED).cause)
    }

    @Test fun bufferingIsTrackedOncePerTransitionAndNeverCountsInitialLoadAsRebuffering() {
        PlaybackDiagnostics.clear()
        val begin=PlaybackDiagnostics.begin("provider-with-secret","live",
            "https://example.test/live/user/password/42.ts?token=secret")
        val first=PlaybackDiagnostics.buffering(begin)
        assertEquals(1,first.bufferingCount)
        assertEquals(0,first.rebufferCount)
        assertEquals(first,PlaybackDiagnostics.buffering(first))
        ShadowSystemClock.advanceBy(Duration.ofMillis(3000))
        val ready=PlaybackDiagnostics.ready(first)
        assertEquals(0,ready.rebufferDurationMs)

        val frame=PlaybackDiagnostics.firstFrame(ready)
        ShadowSystemClock.advanceBy(Duration.ofMillis(1000))
        val buffering=PlaybackDiagnostics.buffering(frame)
        assertEquals(1,buffering.rebufferCount)
        ShadowSystemClock.advanceBy(Duration.ofMillis(1500))
        val resumed=PlaybackDiagnostics.ready(buffering)
        assertTrue(resumed.rebufferDurationMs >= 1500L)
        assertEquals(2,resumed.bufferingCount)
        assertEquals(1,resumed.rebufferCount)
        val interrupted=PlaybackDiagnostics.buffering(resumed)
        ShadowSystemClock.advanceBy(Duration.ofMillis(1100))
        val final=PlaybackDiagnostics.finish(interrupted)
        assertEquals(2,final.rebufferCount)
        assertTrue(final.rebufferDurationMs >= 2600L)
        assertNull(final.bufferStartedAtElapsedMs)
        assertFalse(final.url.contains("password"))
        assertFalse(final.url.contains("token="))
        assertEquals(final,PlaybackDiagnostics.snapshot().last())
    }
}
