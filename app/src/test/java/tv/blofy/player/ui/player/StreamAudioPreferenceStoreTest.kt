package tv.blofy.player.ui.player

import android.app.Application
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(manifest = Config.NONE, sdk = [28], application = Application::class)
class StreamAudioPreferenceStoreTest {
    private val ctx get() = RuntimeEnvironment.getApplication()

    @Test fun userCanKeepDifferentVoiceAndSecondsPerLiveChannel() {
        StreamAudioPreferenceStore.clear(ctx, "1001")
        StreamAudioPreferenceStore.clear(ctx, "1002")
        assertTrue(StreamAudioPreferenceStore.save(ctx,"1001","anis-max-1",3))
        assertTrue(StreamAudioPreferenceStore.save(ctx,"1002","anis-sport-9",7))
        assertEquals("anis-max-1",StreamAudioPreferenceStore.read(ctx,"1001")?.trackId)
        assertEquals(3,StreamAudioPreferenceStore.read(ctx,"1001")?.delaySeconds)
        assertEquals("anis-sport-9",StreamAudioPreferenceStore.read(ctx,"1002")?.trackId)
        assertEquals(7,StreamAudioPreferenceStore.read(ctx,"1002")?.delaySeconds)
        StreamAudioPreferenceStore.clear(ctx,"1001")
        assertNull(StreamAudioPreferenceStore.read(ctx,"1001"))
        assertNotNull(StreamAudioPreferenceStore.read(ctx,"1002"))
        StreamAudioPreferenceStore.clear(ctx,"1002")
    }

    @Test fun savedOffsetIsBoundedAndSecretsCannotBeStored() {
        StreamAudioPreferenceStore.clear(ctx,"1717")
        assertFalse(StreamAudioPreferenceStore.save(ctx,"../123","anis-max-1",4))
        assertFalse(StreamAudioPreferenceStore.save(ctx,"1717","http://radio.example/path?token=secret",4))
        assertFalse(StreamAudioPreferenceStore.save(ctx,"1717","Bearer raw-session-token",4))
        assertFalse(StreamAudioPreferenceStore.save(ctx,"1717","evil-domain",4))
        assertNull(StreamAudioPreferenceStore.read(ctx,"1717"))
        assertTrue(StreamAudioPreferenceStore.save(ctx,"1717","anis-max-2",999))
        assertEquals(30,StreamAudioPreferenceStore.read(ctx,"1717")?.delaySeconds)
        StreamAudioPreferenceStore.clear(ctx,"1717")
    }
}
