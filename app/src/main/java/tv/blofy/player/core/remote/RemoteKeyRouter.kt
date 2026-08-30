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
            KeyEvent.KEYCODE_0 -> 0
            KeyEvent.KEYCODE_1 -> 1
            KeyEvent.KEYCODE_2 -> 2
            KeyEvent.KEYCODE_3 -> 3
            KeyEvent.KEYCODE_4 -> 4
            KeyEvent.KEYCODE_5 -> 5
            KeyEvent.KEYCODE_6 -> 6
            KeyEvent.KEYCODE_7 -> 7
            KeyEvent.KEYCODE_8 -> 8
            KeyEvent.KEYCODE_9 -> 9
            else -> null
        }
        if (digit != null) return RoutedKey(RemoteAction.DIGIT, digit)
        return RoutedKey(when (event.keyCode) {
            KeyEvent.KEYCODE_BACK -> RemoteAction.BACK
            KeyEvent.KEYCODE_DPAD_CENTER, KeyEvent.KEYCODE_ENTER -> RemoteAction.OK
            KeyEvent.KEYCODE_DPAD_UP -> RemoteAction.UP
            KeyEvent.KEYCODE_DPAD_DOWN -> RemoteAction.DOWN
            KeyEvent.KEYCODE_DPAD_LEFT -> RemoteAction.LEFT
            KeyEvent.KEYCODE_DPAD_RIGHT -> RemoteAction.RIGHT
            KeyEvent.KEYCODE_CHANNEL_UP, KeyEvent.KEYCODE_MEDIA_NEXT -> RemoteAction.CHANNEL_NEXT
            KeyEvent.KEYCODE_CHANNEL_DOWN, KeyEvent.KEYCODE_MEDIA_PREVIOUS -> RemoteAction.CHANNEL_PREVIOUS
            KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE, KeyEvent.KEYCODE_MEDIA_PLAY, KeyEvent.KEYCODE_MEDIA_PAUSE -> RemoteAction.PLAY_PAUSE
            KeyEvent.KEYCODE_MEDIA_FAST_FORWARD -> RemoteAction.FAST_FORWARD
            KeyEvent.KEYCODE_MEDIA_REWIND -> RemoteAction.REWIND
            else -> RemoteAction.UNKNOWN
        })
    }
}
