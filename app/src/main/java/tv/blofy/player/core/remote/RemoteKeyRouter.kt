package tv.blofy.player.core.remote

import android.view.KeyEvent

enum class RemoteAction {
    BACK, OK, UP, DOWN, LEFT, RIGHT,
    CHANNEL_NEXT, CHANNEL_PREVIOUS,
    PLAY_PAUSE, FAST_FORWARD, REWIND,
    DIGIT, UNKNOWN
}

data class RoutedKey(val action: RemoteAction, val digit: Int? = null)

object RemoteKeyRouter {
    fun route(event: KeyEvent): RoutedKey {
        if (event.action != KeyEvent.ACTION_DOWN) return RoutedKey(RemoteAction.UNKNOWN)

        val digit = when (event.keyCode) {
            KeyEvent.KEYCODE_0, KeyEvent.KEYCODE_NUMPAD_0 -> 0
            KeyEvent.KEYCODE_1, KeyEvent.KEYCODE_NUMPAD_1 -> 1
            KeyEvent.KEYCODE_2, KeyEvent.KEYCODE_NUMPAD_2 -> 2
            KeyEvent.KEYCODE_3, KeyEvent.KEYCODE_NUMPAD_3 -> 3
            KeyEvent.KEYCODE_4, KeyEvent.KEYCODE_NUMPAD_4 -> 4
            KeyEvent.KEYCODE_5, KeyEvent.KEYCODE_NUMPAD_5 -> 5
            KeyEvent.KEYCODE_6, KeyEvent.KEYCODE_NUMPAD_6 -> 6
            KeyEvent.KEYCODE_7, KeyEvent.KEYCODE_NUMPAD_7 -> 7
            KeyEvent.KEYCODE_8, KeyEvent.KEYCODE_NUMPAD_8 -> 8
            KeyEvent.KEYCODE_9, KeyEvent.KEYCODE_NUMPAD_9 -> 9
            else -> null
        }
        if (digit != null) {
            return if (event.repeatCount == 0) RoutedKey(RemoteAction.DIGIT, digit)
            else RoutedKey(RemoteAction.UNKNOWN)
        }

        // Directional keys are intentionally allowed to repeat while held so long lists remain fast.
        // Destructive/confirm/media actions are edge-triggered only. Some Android TV remotes emit
        // repeated ACTION_DOWN events while OK is held for a fraction of a second; treating those
        // as fresh clicks can open the same screen multiple times and make the UI feel frozen.
        return RoutedKey(
            when (event.keyCode) {
                KeyEvent.KEYCODE_DPAD_UP -> RemoteAction.UP
                KeyEvent.KEYCODE_DPAD_DOWN -> RemoteAction.DOWN
                KeyEvent.KEYCODE_DPAD_LEFT -> RemoteAction.LEFT
                KeyEvent.KEYCODE_DPAD_RIGHT -> RemoteAction.RIGHT

                KeyEvent.KEYCODE_BACK, KeyEvent.KEYCODE_ESCAPE -> if (event.repeatCount == 0) RemoteAction.BACK else RemoteAction.UNKNOWN
                KeyEvent.KEYCODE_DPAD_CENTER,
                KeyEvent.KEYCODE_ENTER,
                KeyEvent.KEYCODE_NUMPAD_ENTER,
                KeyEvent.KEYCODE_BUTTON_A -> if (event.repeatCount == 0) RemoteAction.OK else RemoteAction.UNKNOWN

                KeyEvent.KEYCODE_CHANNEL_UP, KeyEvent.KEYCODE_MEDIA_NEXT -> if (event.repeatCount == 0) RemoteAction.CHANNEL_NEXT else RemoteAction.UNKNOWN
                KeyEvent.KEYCODE_CHANNEL_DOWN, KeyEvent.KEYCODE_MEDIA_PREVIOUS -> if (event.repeatCount == 0) RemoteAction.CHANNEL_PREVIOUS else RemoteAction.UNKNOWN
                KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE,
                KeyEvent.KEYCODE_MEDIA_PLAY,
                KeyEvent.KEYCODE_MEDIA_PAUSE -> if (event.repeatCount == 0) RemoteAction.PLAY_PAUSE else RemoteAction.UNKNOWN
                KeyEvent.KEYCODE_MEDIA_FAST_FORWARD -> if (event.repeatCount == 0) RemoteAction.FAST_FORWARD else RemoteAction.UNKNOWN
                KeyEvent.KEYCODE_MEDIA_REWIND -> if (event.repeatCount == 0) RemoteAction.REWIND else RemoteAction.UNKNOWN
                else -> RemoteAction.UNKNOWN
            }
        )
    }
}
