package tv.blofy.player.ui.common

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Test

class StableIdsTest {
    @Test
    fun stableIdIsDeterministic() {
        assertEquals(stableId64("provider:movie:123"), stableId64("provider:movie:123"))
    }

    @Test
    fun separatesKnownJavaHashCollision() {
        // "FB" and "Ea" have the same Java String.hashCode().
        assertEquals("FB".hashCode(), "Ea".hashCode())
        assertNotEquals(stableId64("FB"), stableId64("Ea"))
    }
}
