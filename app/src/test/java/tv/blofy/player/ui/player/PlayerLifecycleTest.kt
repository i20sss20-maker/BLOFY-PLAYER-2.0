package tv.blofy.player.ui.player

import android.app.Application
import android.content.Intent
import android.os.Bundle
import android.os.Looper
import androidx.annotation.OptIn
import androidx.media3.common.*
import androidx.media3.common.text.CueGroup
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.ExoPlayer
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import org.robolectric.annotation.LooperMode
import tv.blofy.player.R
import tv.blofy.player.core.playback.BlofyPlaybackSession
import tv.blofy.player.core.provider.ProviderProfile
import java.lang.reflect.Proxy

@OptIn(markerClass = [UnstableApi::class])
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [23, 28], application = Application::class)
@LooperMode(LooperMode.Mode.PAUSED)
class PlayerLifecycleTest {
    class FakePlayer {
        val listeners = mutableListOf<Player.Listener>()
        var item: MediaItem? = null
        var position = 0L
        var ready = false
        var releases = 0
        var prepares = 0
        var tracks = TrackSelectionParameters.DEFAULT_WITHOUT_CONTEXT
        val player = Proxy.newProxyInstance(ExoPlayer::class.java.classLoader, arrayOf(ExoPlayer::class.java)) { proxy, method, args ->
            when (method.name) {
                "getApplicationLooper" -> Looper.getMainLooper()
                "addListener" -> { listeners += args!![0] as Player.Listener; Unit }
                "removeListener" -> { listeners -= args!![0] as Player.Listener; Unit }
                "getAvailableCommands" -> Player.Commands.EMPTY
                "getCurrentMediaItem" -> item
                "setMediaItem" -> { item = args!![0] as MediaItem; position = 0L; Unit }
                "getCurrentPosition", "getContentPosition", "getBufferedPosition" -> position
                "seekTo" -> { position = args!!.last() as Long; Unit }
                "getDuration", "getContentDuration" -> 100_000L
                "getPlaybackState" -> Player.STATE_IDLE
                "getPlayWhenReady", "isPlaying" -> ready
                "setPlayWhenReady" -> { ready = args!![0] as Boolean; Unit }
                "getTrackSelectionParameters" -> tracks
                "setTrackSelectionParameters" -> { tracks = args!![0] as TrackSelectionParameters; Unit }
                "getCurrentTracks" -> Tracks.EMPTY
                "getCurrentTimeline" -> Timeline.EMPTY
                "getMediaMetadata", "getPlaylistMetadata" -> MediaMetadata.EMPTY
                "getVideoSize" -> VideoSize.UNKNOWN
                "getCurrentCues" -> CueGroup.EMPTY_TIME_ZERO
                "getDeviceInfo" -> DeviceInfo.UNKNOWN
                "getAudioAttributes" -> AudioAttributes.DEFAULT
                "getPlaybackParameters" -> PlaybackParameters.DEFAULT
                "prepare" -> { check(releases == 0); prepares++; Unit }
                "release" -> { releases++; listeners.toList().forEach { it.onPlaybackStateChanged(Player.STATE_ENDED) }; Unit }
                "toString" -> "FakePlayback"
                "hashCode" -> System.identityHashCode(this)
                "equals" -> args?.firstOrNull() === proxy
                else -> when (method.returnType) {
                    Boolean::class.javaPrimitiveType -> false
                    Int::class.javaPrimitiveType -> 0
                    Long::class.javaPrimitiveType -> 0L
                    Float::class.javaPrimitiveType -> 1f
                    else -> null
                }
            }
        } as ExoPlayer
    }

    class TestPlayerActivity : PlayerActivity() {
        val players = mutableListOf<FakePlayer>()
        override fun onCreate(savedInstanceState: Bundle?) {
            setTheme(R.style.Theme_Blofy)
            super.onCreate(savedInstanceState)
        }
        override fun createPlaybackSession(): BlofyPlaybackSession {
            val fake = FakePlayer().also(players::add)
            return BlofyPlaybackSession(this, ProviderProfile("lifecycle-test"), "episode", playerFactory = { _, _ -> fake.player })
        }
    }

    private fun intent() = Intent(RuntimeEnvironment.getApplication(), TestPlayerActivity::class.java)
        .putExtra(PlayerActivity.EXTRA_URL, "https://example.test/series/u/p/1.mkv")
        .putExtra(PlayerActivity.EXTRA_KIND, "episode")
        .putStringArrayListExtra(PlayerActivity.EXTRA_FALLBACK_URLS, arrayListOf("https://example.test/series/u/p/1.mp4"))

    @Test fun backgroundReleasesAndReturnRestoresCurrentEpisodePositionAndPauseState() {
        val controller = Robolectric.buildActivity(TestPlayerActivity::class.java, intent()).create().start().resume()
        val activity = controller.get()
        val first = activity.players.single()
        first.item = MediaItem.fromUri("https://example.test/series/u/p/2.mkv")
        first.position = 45_000L
        first.ready = false
        first.tracks = first.tracks.buildUpon().setPreferredAudioLanguage("ar").build()
        controller.pause().stop()
        assertEquals(1, first.releases)
        controller.restart().start().resume()
        val restored = activity.players.last()
        assertEquals(2, activity.players.size)
        assertEquals("https://example.test/series/u/p/2.mkv", restored.item!!.localConfiguration!!.uri.toString())
        assertEquals(45_000L, restored.position)
        assertFalse(restored.ready)
        assertEquals(first.tracks, restored.tracks)
        controller.pause().stop().destroy()
        assertEquals(1, restored.releases)
        assertEquals(1, first.releases)
    }

    @Test fun backClosesBeforeStopAndDestroyCannotRestartOrReleaseTwice() {
        val controller = Robolectric.buildActivity(TestPlayerActivity::class.java, intent()).create().start().resume()
        val activity = controller.get()
        val first = activity.players.single()
        activity.finish()
        controller.pause()
        assertEquals(1, first.releases)
        controller.stop().destroy()
        assertEquals(1, first.releases)
        assertEquals(1, first.prepares)
    }

    @Test fun liveResumeStartsAtLiveEdgeInsteadOfAnExpiredPosition() {
        val fake = FakePlayer()
        val session = BlofyPlaybackSession(RuntimeEnvironment.getApplication(), ProviderProfile("live-lifecycle"), "live",
            playerFactory = { _, _ -> fake.player })
        session.play("https://example.test/live/u/p/1.ts")
        fake.position = 90_000L
        assertEquals(0L, session.resumeState()!!.positionMs)
        session.release()
        assertNull(session.resumeState())
    }
}
