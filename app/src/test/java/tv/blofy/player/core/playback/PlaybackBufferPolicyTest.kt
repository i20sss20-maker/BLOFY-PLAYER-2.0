package tv.blofy.player.core.playback

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class PlaybackBufferPolicyTest {
    @Test fun liveHasBoundedBufferForLowMemoryAndroidTv() {
        val live = PlaybackBufferPolicy.forKind("live")
        assertEquals(live, PlaybackBufferPolicy.forKind("live_preview"))
        assertTrue(live.maxBufferBytes <= 16 * 1024 * 1024)
        assertTrue(live.maxBufferMs <= 22_000)
        assertTrue(live.minBufferMs <= live.maxBufferMs)
        assertTrue(live.afterRebufferMs > live.playbackStartMs)
    }

    @Test fun onDemandCanAbsorbMoreJitterWithoutUnlimitedMemory() {
        val vod = PlaybackBufferPolicy.forKind("episode")
        assertEquals(vod, PlaybackBufferPolicy.forKind("movie"))
        assertTrue(vod.minBufferMs > PlaybackBufferPolicy.forKind("live").minBufferMs)
        assertTrue(vod.maxBufferBytes <= 24 * 1024 * 1024)
        assertTrue(vod.maxBufferMs <= 40_000)
    }

    @Test(expected = IllegalArgumentException::class)
    fun invalidUnboundedBufferIsRejected() {
        PlaybackBufferBudget(1_000, 30_000, 500, 1_000, 128 * 1024 * 1024)
    }
}
