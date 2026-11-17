package tv.blofy.player.core.remote

import android.app.Application
import android.view.KeyEvent
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28], application = Application::class)
class RemoteKeyRouterTest {
    private fun action(key: Int): RemoteAction =
        RemoteKeyRouter.route(KeyEvent(KeyEvent.ACTION_DOWN, key)).action

    @Test fun selectButtonsActivateFocusedTvControls() {
        assertEquals(RemoteAction.OK, action(KeyEvent.KEYCODE_DPAD_CENTER))
        assertEquals(RemoteAction.OK, action(KeyEvent.KEYCODE_NUMPAD_ENTER))
        assertEquals(RemoteAction.OK, action(KeyEvent.KEYCODE_BUTTON_A))
    }

    @Test fun mediaKeysAndDpadDirectionAreNotConfused() {
        assertEquals(RemoteAction.PLAY_PAUSE, action(KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE))
        assertEquals(RemoteAction.PLAY_PAUSE, action(KeyEvent.KEYCODE_SPACE))
        assertEquals(RemoteAction.FAST_FORWARD, action(KeyEvent.KEYCODE_MEDIA_FAST_FORWARD))
        assertEquals(RemoteAction.REWIND, action(KeyEvent.KEYCODE_MEDIA_REWIND))
        assertEquals(RemoteAction.LEFT, action(KeyEvent.KEYCODE_DPAD_LEFT))
        assertEquals(RemoteAction.RIGHT, action(KeyEvent.KEYCODE_DPAD_RIGHT))
    }

    @Test fun keyReleaseDoesNotRepeatAnAction() {
        assertEquals(RemoteAction.UNKNOWN,
            RemoteKeyRouter.route(KeyEvent(KeyEvent.ACTION_UP, KeyEvent.KEYCODE_ENTER)).action)
    }
}
