package tv.blofy.player.ui.player

internal enum class HudOkAction {
    SHOW_HUD,
    HIDE_HUD,
    CLICK_FOCUSED_CONTROL
}

internal object PlayerHudKeyPolicy {
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
}
