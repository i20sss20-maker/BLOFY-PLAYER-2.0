package tv.blofy.player.ui.player

internal enum class HudOkAction {
    SHOW_HUD,
    HIDE_HUD,
    CLICK_FOCUSED_CONTROL
}

internal object PlayerHudKeyPolicy {
    fun okAction(hudVisible: Boolean, focusedHudControlClickable: Boolean): HudOkAction = when {
        !hudVisible -> HudOkAction.SHOW_HUD
        focusedHudControlClickable -> HudOkAction.CLICK_FOCUSED_CONTROL
        else -> HudOkAction.HIDE_HUD
    }
}
