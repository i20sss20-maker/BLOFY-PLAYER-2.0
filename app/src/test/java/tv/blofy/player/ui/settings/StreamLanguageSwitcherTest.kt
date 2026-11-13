package tv.blofy.player.ui.settings

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class StreamLanguageSwitcherTest {
    @Test fun streamOnlySupportsFullyTranslatedArabicAndEnglish() {
        assertTrue(StreamLanguageSwitcher.validTag("ar"))
        assertTrue(StreamLanguageSwitcher.validTag("en"))
        assertFalse(StreamLanguageSwitcher.validTag("fr"))
        assertFalse(StreamLanguageSwitcher.validTag(""))
        assertFalse(StreamLanguageSwitcher.validTag("ar;en"))
    }
}
