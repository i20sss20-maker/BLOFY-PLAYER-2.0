package tv.blofy.player.ui.player

import android.view.KeyEvent

/**
 * Explicit live-TV remote routing. A short OK opens the channel list while
 * STREAM shows one joined channel/action sidebar for MENU, OK and UP/DOWN.
 * Original PLAYER keeps its existing in-player controls. Visible controls
 * still own focused OK/DPAD navigation.
 */
internal enum class LivePlayerMenuAction {
    PASS_THROUGH, SHOW_AUDIO_CONTROLS, SHOW_CHANNEL_LIST, DISMISS_CONTROLS, RETURN_TO_BROWSER
}

internal object LivePlayerMenuPolicy {
    fun action(keyCode: Int, hudVisible: Boolean, channelDialogVisible: Boolean,
        unifiedChannelPanel: Boolean = false): LivePlayerMenuAction {
        if (channelDialogVisible) return LivePlayerMenuAction.PASS_THROUGH
        return when (keyCode) {
            KeyEvent.KEYCODE_MENU, KeyEvent.KEYCODE_TV_CONTENTS_MENU ->
                if (unifiedChannelPanel) LivePlayerMenuAction.SHOW_CHANNEL_LIST
                else LivePlayerMenuAction.SHOW_AUDIO_CONTROLS
            KeyEvent.KEYCODE_DPAD_UP, KeyEvent.KEYCODE_DPAD_DOWN ->
                if (unifiedChannelPanel) LivePlayerMenuAction.SHOW_CHANNEL_LIST
                else if (hudVisible) LivePlayerMenuAction.PASS_THROUGH
                else LivePlayerMenuAction.SHOW_AUDIO_CONTROLS
            KeyEvent.KEYCODE_GUIDE -> LivePlayerMenuAction.SHOW_CHANNEL_LIST
            KeyEvent.KEYCODE_DPAD_CENTER, KeyEvent.KEYCODE_ENTER,
            KeyEvent.KEYCODE_NUMPAD_ENTER -> LivePlayerMenuAction.SHOW_CHANNEL_LIST
            KeyEvent.KEYCODE_BACK ->
                if (hudVisible) LivePlayerMenuAction.DISMISS_CONTROLS
                else LivePlayerMenuAction.RETURN_TO_BROWSER
            else -> LivePlayerMenuAction.PASS_THROUGH
        }
    }
}
