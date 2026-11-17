package tv.blofy.player.ui.player

internal enum class HudOkAction {
    SHOW_HUD,
    HIDE_HUD,
    CLICK_FOCUSED_CONTROL
}

internal enum class HudHorizontalAction { SEEK, NAVIGATE_CONTROLS }

internal object PlayerHudKeyPolicy {
    /** Seeking remains active while HUD is a transient hint, until OK focuses controls. */
    fun horizontalAction(hudVisible: Boolean, focusedHudControlClickable: Boolean): HudHorizontalAction =
        if (hudVisible && focusedHudControlClickable) HudHorizontalAction.NAVIGATE_CONTROLS
        else HudHorizontalAction.SEEK

    /** Throttle rapid remote repeats to prevent accidental huge jumps. */
    fun seekStepMs(repeatCount: Int): Long = when {
        repeatCount <= 0 -> 10_000L
        repeatCount < 4 || repeatCount % 4 != 0 -> 0L
        repeatCount < 12 -> 15_000L
        else -> 30_000L
    }

    /**
     * TV-first OK behavior: opening the HUD is always safe, and once it is visible OK should only
     * activate an actual focused control. If focus is temporarily between controls during D-pad
     * navigation, keep the HUD visible instead of making the whole overlay disappear underneath
     * the user. Back remains the explicit way to dismiss the overlay.
     */
    fun okAction(hudVisible: Boolean, focusedHudControlClickable: Boolean): HudOkAction = when {
        !hudVisible -> HudOkAction.SHOW_HUD
        focusedHudControlClickable -> HudOkAction.CLICK_FOCUSED_CONTROL
        else -> HudOkAction.SHOW_HUD
    }

    fun wrappedHorizontalIndex(index: Int, size: Int, delta: Int): Int {
        if (size <= 0 || index !in 0 until size) return -1
        return ((index + delta) % size + size) % size
    }
}
