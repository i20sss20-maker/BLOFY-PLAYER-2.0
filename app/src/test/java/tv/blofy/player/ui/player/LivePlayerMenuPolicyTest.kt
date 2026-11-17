package tv.blofy.player.ui.player

import android.view.KeyEvent
import org.junit.Assert.assertEquals
import org.junit.Test

class LivePlayerMenuPolicyTest {
    private fun key(code: Int, hud: Boolean = false, dialog: Boolean = false) =
        LivePlayerMenuPolicy.action(code, hud, dialog)

    @Test fun menuAndDpadExposeAudioWithoutLeavingLivePlayback() {
        assertEquals(LivePlayerMenuAction.SHOW_AUDIO_CONTROLS, key(KeyEvent.KEYCODE_MENU))
        assertEquals(LivePlayerMenuAction.SHOW_AUDIO_CONTROLS, key(KeyEvent.KEYCODE_TV_CONTENTS_MENU))
        assertEquals(LivePlayerMenuAction.SHOW_AUDIO_CONTROLS, key(KeyEvent.KEYCODE_DPAD_UP))
        assertEquals(LivePlayerMenuAction.SHOW_AUDIO_CONTROLS, key(KeyEvent.KEYCODE_DPAD_DOWN))
    }

    @Test fun centerShowsChannelsUnlessControlsNeedClick() {
        assertEquals(LivePlayerMenuAction.SHOW_CHANNEL_LIST, key(KeyEvent.KEYCODE_DPAD_CENTER))
        assertEquals(LivePlayerMenuAction.PASS_THROUGH, key(KeyEvent.KEYCODE_DPAD_CENTER, hud = true))
        assertEquals(LivePlayerMenuAction.SHOW_CHANNEL_LIST, key(KeyEvent.KEYCODE_GUIDE))
    }

    @Test fun backFirstDismissesControlsInsteadOfExiting() {
        assertEquals(LivePlayerMenuAction.DISMISS_CONTROLS, key(KeyEvent.KEYCODE_BACK, hud = true))
        assertEquals(LivePlayerMenuAction.RETURN_TO_BROWSER, key(KeyEvent.KEYCODE_BACK))
    }

    @Test fun streamUnifiedPanelReplacesDetachedHudOnMenuAndArrows() {
        assertEquals(LivePlayerMenuAction.SHOW_CHANNEL_LIST,
            LivePlayerMenuPolicy.action(KeyEvent.KEYCODE_MENU, false, false, true))
        assertEquals(LivePlayerMenuAction.SHOW_CHANNEL_LIST,
            LivePlayerMenuPolicy.action(KeyEvent.KEYCODE_DPAD_UP, false, false, true))
        assertEquals(LivePlayerMenuAction.SHOW_CHANNEL_LIST,
            LivePlayerMenuPolicy.action(KeyEvent.KEYCODE_DPAD_DOWN, false, false, true))
        assertEquals(LivePlayerMenuAction.SHOW_CHANNEL_LIST,
            LivePlayerMenuPolicy.action(KeyEvent.KEYCODE_DPAD_CENTER, false, false, true))
        assertEquals(LivePlayerMenuAction.PASS_THROUGH,
            LivePlayerMenuPolicy.action(KeyEvent.KEYCODE_DPAD_DOWN, true, false, true))
        assertEquals(LivePlayerMenuAction.PASS_THROUGH,
            LivePlayerMenuPolicy.action(KeyEvent.KEYCODE_DPAD_CENTER, true, false, true))
    }

    @Test fun searchKeyOpensOnlySearchWindowInStreamNotChannelWindow() {
        assertEquals(LivePlayerMenuAction.SHOW_SEARCH_WINDOW,
            LivePlayerMenuPolicy.action(KeyEvent.KEYCODE_SEARCH, false, false, true))
        assertEquals(LivePlayerMenuAction.PASS_THROUGH,
            LivePlayerMenuPolicy.action(KeyEvent.KEYCODE_SEARCH, false, false, false))
        assertEquals(LivePlayerMenuAction.PASS_THROUGH,
            LivePlayerMenuPolicy.action(KeyEvent.KEYCODE_SEARCH, false, true, true))
    }

    @Test fun openDialogOwnsItsNavigationAndSelection() {
        assertEquals(LivePlayerMenuAction.PASS_THROUGH,
            key(KeyEvent.KEYCODE_DPAD_CENTER, dialog = true))
        assertEquals(LivePlayerMenuAction.PASS_THROUGH,
            key(KeyEvent.KEYCODE_BACK, dialog = true))
    }
}
