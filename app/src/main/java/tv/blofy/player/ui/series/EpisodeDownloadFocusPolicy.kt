package tv.blofy.player.ui.series

import android.view.KeyEvent

/** Deterministic TV D-pad navigation without intercepting click/OK events. */
internal object EpisodeDownloadFocusPolicy {
    fun towardsDownload(keyCode: Int, rtl: Boolean): Boolean =
        keyCode == if (rtl) KeyEvent.KEYCODE_DPAD_LEFT else KeyEvent.KEYCODE_DPAD_RIGHT

    fun towardsEpisode(keyCode: Int, rtl: Boolean): Boolean =
        keyCode == if (rtl) KeyEvent.KEYCODE_DPAD_RIGHT else KeyEvent.KEYCODE_DPAD_LEFT
}
