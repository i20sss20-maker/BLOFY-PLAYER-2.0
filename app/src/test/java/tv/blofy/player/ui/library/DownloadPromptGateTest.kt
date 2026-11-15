package tv.blofy.player.ui.library

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class DownloadPromptGateTest {
    @Test fun doubleTapDoesNotCreateOverlappingDownloadPrompts() {
        val gate = DownloadPromptGate()
        val screen = Any()
        assertTrue(gate.enter(screen))
        assertFalse(gate.enter(screen))
        gate.leave(screen)
        assertTrue(gate.enter(screen))
    }

    @Test fun differentScreensRemainIndependent() {
        val gate = DownloadPromptGate()
        val a = Any()
        val b = Any()
        assertTrue(gate.enter(a))
        assertTrue(gate.enter(b))
        gate.leave(a)
        assertFalse(gate.enter(b))
        gate.leave(b)
        assertTrue(gate.enter(b))
    }
}
