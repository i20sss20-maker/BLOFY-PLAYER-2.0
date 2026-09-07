package tv.blofy.player.core.playback

import android.app.Application
import androidx.annotation.OptIn
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.lang.reflect.Proxy

@OptIn(markerClass = [UnstableApi::class])
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28], application = Application::class)
class PlaybackFallbackResumeTest {
    private class ResettingPlayer(initialPosition: Long) {
        var position = initialPosition
        var item: MediaItem? = null
        var ready = false
        var playing = false
        var seekCount = 0
        val player = Proxy.newProxyInstance(Player::class.java.classLoader, arrayOf(Player::class.java)) { _, method, args ->
            when (method.name) {
                "getCurrentPosition" -> position
                "stop" -> { position = 0L; ready = false; Unit }
                "setMediaItem" -> { item = args!![0] as MediaItem; position = 0L; Unit }
                "prepare" -> { ready = true; Unit }
                "seekTo" -> { check(ready); position = args!![0] as Long; seekCount++; Unit }
                "setPlayWhenReady" -> { playing = args!![0] as Boolean; Unit }
                "toString" -> "ResettingPlayer"
                else -> error("Unexpected player operation: ${method.name}")
            }
        } as Player
    }

    @Test fun fallbackResumesVodFromThePositionBeforeSourceReset() {
        val fake = ResettingPlayer(734_000L)
        val fallback = MediaItem.fromUri("https://example.test/direct/movie.mp4")
        prepareFallbackItem(fake.player, fallback, live = false)
        assertEquals(734_000L, fake.position)
        assertEquals(fallback, fake.item)
        assertTrue(fake.ready)
        assertTrue(fake.playing)
        assertEquals(1, fake.seekCount)
    }

    @Test fun liveFallbackKeepsDefaultLivePositionWithoutSeekingOldTimeline() {
        val fake = ResettingPlayer(734_000L)
        prepareFallbackItem(fake.player, MediaItem.fromUri("https://example.test/live.m3u8"), live = true)
        assertEquals(0L, fake.position)
        assertEquals(0, fake.seekCount)
        assertTrue(fake.playing)
    }

    @Test fun unsetAndZeroVodPositionsNeverProduceInvalidSeeks() {
        for (position in listOf(C.TIME_UNSET, -1L, 0L)) {
            val fake = ResettingPlayer(position)
            prepareFallbackItem(fake.player, MediaItem.fromUri("https://example.test/movie.mp4"), live = false)
            assertEquals(0L, fake.position)
            assertEquals(0, fake.seekCount)
            assertTrue(fake.playing)
        }
    }
}
