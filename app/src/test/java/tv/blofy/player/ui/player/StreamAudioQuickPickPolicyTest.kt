package tv.blofy.player.ui.player

import org.junit.Assert.assertEquals
import org.junit.Test

class StreamAudioQuickPickPolicyTest {
    private val p = StreamAudioQuickPickPolicy

    @Test fun favoriteAndLastWorkingFirstButFailedAreNotHidden() {
        val tracks = listOf("anis-max-1","anis-max-2","anis-max-3","anis-sport-1")
        assertEquals(listOf("anis-sport-1","anis-max-2","anis-max-1","anis-max-3"),
            p.arrange(tracks, setOf("anis-sport-1"), "anis-max-2",
                setOf("anis-max-3")) { it })
    }

    @Test fun duplicateCatalogueIdsRemovedAndRelativeOrderKept() {
        assertEquals(listOf("anis-a","anis-b"),
            p.arrange(listOf("anis-a","anis-b","anis-a"), emptySet(), null,
                emptySet()) { it })
    }

    @Test fun onlyRealPlaybackMayReceivePlayingState() {
        assertEquals(p.State.FAILED_RECENTLY,
            p.status("anis-a",null,"anis-a",setOf("anis-a")))
        assertEquals(p.State.RECENTLY_WORKED,
            p.status("anis-a",null,"anis-a",emptySet()))
        assertEquals(p.State.PLAYING,
            p.status("anis-a","anis-a","anis-b",setOf("anis-a")))
        assertEquals(p.State.UNTESTED,
            p.status("anis-z",null,"anis-b",emptySet()))
    }
}
