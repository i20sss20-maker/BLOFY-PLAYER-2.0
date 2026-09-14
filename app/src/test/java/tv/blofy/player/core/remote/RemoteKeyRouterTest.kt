package tv.blofy.player.core.remote

import android.view.KeyEvent
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28])
class RemoteKeyRouterTest {
    private fun key(code: Int, repeat: Int = 0, action: Int = KeyEvent.ACTION_DOWN): KeyEvent =
        KeyEvent(0L, 10L, action, code, repeat)

    @Test fun centerRepeatIsIgnoredButFirstPressOpensOnce() {
        assertEquals(RemoteAction.OK, RemoteKeyRouter.route(key(KeyEvent.KEYCODE_DPAD_CENTER)).action)
        assertEquals(RemoteAction.UNKNOWN, RemoteKeyRouter.route(key(KeyEvent.KEYCODE_DPAD_CENTER, repeat = 1)).action)
    }

    @Test fun enterVariantsMapToOk() {
        assertEquals(RemoteAction.OK, RemoteKeyRouter.route(key(KeyEvent.KEYCODE_ENTER)).action)
        assertEquals(RemoteAction.OK, RemoteKeyRouter.route(key(KeyEvent.KEYCODE_NUMPAD_ENTER)).action)
        assertEquals(RemoteAction.OK, RemoteKeyRouter.route(key(KeyEvent.KEYCODE_BUTTON_A)).action)
    }

    @Test fun heldDirectionalKeysRemainRepeatable() {
        assertEquals(RemoteAction.DOWN, RemoteKeyRouter.route(key(KeyEvent.KEYCODE_DPAD_DOWN, repeat = 4)).action)
        assertEquals(RemoteAction.RIGHT, RemoteKeyRouter.route(key(KeyEvent.KEYCODE_DPAD_RIGHT, repeat = 2)).action)
    }

    @Test fun actionUpAndRepeatedDigitsAreIgnored() {
        assertEquals(RemoteAction.UNKNOWN, RemoteKeyRouter.route(key(KeyEvent.KEYCODE_BACK, action = KeyEvent.ACTION_UP)).action)
        assertEquals(RemoteAction.DIGIT, RemoteKeyRouter.route(key(KeyEvent.KEYCODE_7)).action)
        assertEquals(RemoteAction.UNKNOWN, RemoteKeyRouter.route(key(KeyEvent.KEYCODE_7, repeat = 1)).action)
    }
}
