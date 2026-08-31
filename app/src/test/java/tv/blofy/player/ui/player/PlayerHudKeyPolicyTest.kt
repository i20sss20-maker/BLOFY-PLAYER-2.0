package tv.blofy.player.ui.player

import org.junit.Assert.assertEquals
import org.junit.Test

class PlayerHudKeyPolicyTest {
    @Test
    fun dpadCenterShowsHiddenHud() {
        assertEquals(HudOkAction.SHOW_HUD, PlayerHudKeyPolicy.okAction(false, false))
    }

    @Test
    fun dpadCenterClicksFocusedHudControlWithoutHidingHud() {
        assertEquals(HudOkAction.CLICK_FOCUSED_CONTROL, PlayerHudKeyPolicy.okAction(true, true))
    }

    @Test
    fun dpadCenterKeepsVisibleHudWhenNoActionableControlIsFocused() {
        assertEquals(HudOkAction.KEEP_HUD, PlayerHudKeyPolicy.okAction(true, false))
    }
}