package tv.blofy.player.core.profile

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class KidsPolicyTest {
    @Test fun blocksExplicitAdultMarkersInEnglishAndArabic() {
        assertTrue(KidsPolicy.isBlocked("Adults Only", null, null))
        assertTrue(KidsPolicy.isBlocked("Movie", "18+", null))
        assertTrue(KidsPolicy.isBlocked("فيلم", null, "محتوى للبالغين"))
        assertTrue(KidsPolicy.isBlocked("TV-MA special", null, null))
    }

    @Test fun ordinaryGenresAreNotOverblocked() {
        assertFalse(KidsPolicy.isBlocked("Family Adventure", "Action Drama", "A normal story"))
        assertFalse(KidsPolicy.isBlocked("مسلسل عائلي", "دراما", "قصة عائلية"))
        assertFalse(KidsPolicy.isBlocked(null, null, null))
    }
}
