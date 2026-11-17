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
        assertEquals(HudOkAction.SHOW_HUD, PlayerHudKeyPolicy.okAction(true, false))
    }
    @Test
    fun horizontalDockWrapsInsteadOfDeadEndingAtEdges() {
        assertEquals(4, PlayerHudKeyPolicy.wrappedHorizontalIndex(0, 5, -1))
        assertEquals(0, PlayerHudKeyPolicy.wrappedHorizontalIndex(4, 5, 1))
        assertEquals(2, PlayerHudKeyPolicy.wrappedHorizontalIndex(1, 5, 1))
    }


    @Test
    fun dpadSeeksWhileOnlyTheTransientHudIsVisible() {
        assertEquals(HudHorizontalAction.SEEK, PlayerHudKeyPolicy.horizontalAction(false, false))
        assertEquals(HudHorizontalAction.SEEK, PlayerHudKeyPolicy.horizontalAction(true, false))
        assertEquals(HudHorizontalAction.NAVIGATE_CONTROLS,
            PlayerHudKeyPolicy.horizontalAction(true, true))
    }

    @Test
    fun heldDpadHasBoundedSeekRepeatRate() {
        assertEquals(10_000L, PlayerHudKeyPolicy.seekStepMs(0))
        assertEquals(0L, PlayerHudKeyPolicy.seekStepMs(1))
        assertEquals(0L, PlayerHudKeyPolicy.seekStepMs(3))
        assertEquals(15_000L, PlayerHudKeyPolicy.seekStepMs(4))
        assertEquals(0L, PlayerHudKeyPolicy.seekStepMs(7))
        assertEquals(15_000L, PlayerHudKeyPolicy.seekStepMs(8))
        assertEquals(30_000L, PlayerHudKeyPolicy.seekStepMs(12))
    }
}