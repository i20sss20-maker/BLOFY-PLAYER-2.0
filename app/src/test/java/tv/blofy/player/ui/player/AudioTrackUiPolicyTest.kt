package tv.blofy.player.ui.player

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class AudioTrackUiPolicyTest {
    @Test fun doesNotClaimMissingAudioBeforeTracksAreReady() {
        assertEquals("🔊 الصوت", AudioTrackUiPolicy.buttonLabel(false, 0, 0))
        assertTrue(AudioTrackUiPolicy.unavailableMessage(false, 0).contains("جارٍ قراءة"))
    }

    @Test fun reportsMissingAudioOnlyAfterReady() {
        assertEquals("🔇 لا يوجد مسار صوت", AudioTrackUiPolicy.buttonLabel(true, 0, 0))
        assertTrue(AudioTrackUiPolicy.unavailableMessage(true, 0).contains("المصدر"))
    }

    @Test fun reportsPresentButUnsupportedCodecWithoutClaimingSilentSource() {
        assertEquals("⚠ ترميز صوت غير مدعوم", AudioTrackUiPolicy.buttonLabel(true, 1, 0))
        assertTrue(AudioTrackUiPolicy.unavailableMessage(true, 1, "eac3").contains("eac3"))
        assertTrue(AudioTrackUiPolicy.unavailableMessage(true, 1).contains("الجهاز"))
    }

    @Test fun supportedAndMultiLanguageAudioRemainSelectable() {
        assertEquals("🔊 الصوت", AudioTrackUiPolicy.buttonLabel(true, 1, 1))
        assertEquals("🔊 الصوت (2)", AudioTrackUiPolicy.buttonLabel(true, 3, 2))
    }
}
