package tv.blofy.player.core.playback

import android.app.Application
import android.os.Looper
import androidx.annotation.OptIn
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.ExoPlaybackException
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.ExoTimeoutException
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.annotation.LooperMode
import tv.blofy.player.core.provider.ProviderProfile
import java.lang.reflect.Proxy

@OptIn(markerClass = [UnstableApi::class])
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [23, 28], application = Application::class)
@LooperMode(LooperMode.Mode.PAUSED)
class PlaybackSessionReleaseTest {
    private class FakePlayer {
        lateinit var listener: Player.Listener
        var releases = 0
        var prepares = 0
        var releaseError = false
        val player = Proxy.newProxyInstance(ExoPlayer::class.java.classLoader, arrayOf(ExoPlayer::class.java)) { _, method, args ->
            when (method.name) {
                "addListener" -> { listener = args!![0] as Player.Listener; Unit }
                "getCurrentMediaItem" -> MediaItem.fromUri("https://example.test/live/u/p/1.ts")
                "getCurrentPosition" -> 0L
                "getPlaybackState" -> Player.STATE_IDLE
                "getPlayWhenReady" -> false
                "getVideoFormat" -> null
                "prepare" -> { prepares++; Unit }
                "release" -> { releases++; if (releaseError) timeout(ExoTimeoutException.TIMEOUT_OPERATION_RELEASE); Unit }
                "setAudioAttributes", "stop", "setMediaItem", "setPlayWhenReady" -> Unit
                "toString" -> "FakePlayer"
                else -> error("Unexpected operation: ${method.name}")
            }
        } as ExoPlayer

        fun timeout(operation: Int) = listener.onPlayerError(ExoPlaybackException.createForUnexpected(
            ExoTimeoutException(operation), PlaybackException.ERROR_CODE_TIMEOUT
        ))
    }

    private fun session(fake: FakePlayer) = BlofyPlaybackSession(RuntimeEnvironment.getApplication(),
        ProviderProfile("release-test"), "live_preview", playerFactory = { _, _ -> fake.player })

    @Test fun releaseTimeoutNeverRetriesOrPenalizesTheProvider() {
        val fake = FakePlayer().apply { releaseError = true }
        val session = session(fake)
        session.release()
        shadowOf(Looper.getMainLooper()).idle()
        assertEquals(1, fake.releases)
        assertEquals(0, fake.prepares)
        val prefs = RuntimeEnvironment.getApplication().getSharedPreferences("blofy_playback_intelligence", 0)
        assertEquals(0, prefs.getInt("release-test.ts.failure", 0))
    }

    @Test fun surfaceDetachTimeoutDuringCloseCannotScheduleAnotherStream() {
        val fake = FakePlayer()
        val session = session(fake)
        session.release { fake.timeout(ExoTimeoutException.TIMEOUT_OPERATION_DETACH_SURFACE) }
        shadowOf(Looper.getMainLooper()).idle()
        assertEquals(1, fake.releases)
        assertEquals(0, fake.prepares)
    }

    @Test fun pendingRetryIsCancelledAndClosedSessionCannotBeRestarted() {
        val fake = FakePlayer()
        val session = session(fake)
        fake.timeout(ExoTimeoutException.TIMEOUT_OPERATION_DETACH_SURFACE)
        session.release()
        session.retrySameUrl()
        session.play("https://example.test/live/u/p/2.ts")
        shadowOf(Looper.getMainLooper()).idle()
        assertEquals(0, fake.prepares)
        assertFalse(session.isStarted())
    }

    @Test fun activePlaybackErrorStillRetries() {
        val fake = FakePlayer()
        val session = session(fake)
        try {
            fake.timeout(ExoTimeoutException.TIMEOUT_OPERATION_DETACH_SURFACE)
            shadowOf(Looper.getMainLooper()).idle()
            assertEquals(1, fake.prepares)
        } finally { session.release() }
    }

    @Test fun duplicateCloseDetachesAndReleasesOnlyOnce() {
        val fake = FakePlayer()
        val session = session(fake)
        var detaches = 0
        session.release { detaches++ }
        session.release { detaches++ }
        assertEquals(1, detaches)
        assertEquals(1, fake.releases)
    }

    @Test fun detachFailureStillReleasesPlayer() {
        val fake = FakePlayer()
        val session = session(fake)
        assertTrue(runCatching { session.release { error("detach failed") } }.isFailure)
        assertEquals(1, fake.releases)
        shadowOf(Looper.getMainLooper()).idle()
        assertEquals(0, fake.prepares)
    }
}
