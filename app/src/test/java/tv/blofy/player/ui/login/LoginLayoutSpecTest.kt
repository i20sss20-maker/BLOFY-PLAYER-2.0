package tv.blofy.player.ui.login

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class LoginLayoutSpecTest {
    @Test fun qrRemainsSquareFriendlyAcrossTvSizes() {
        assertEquals(132, LoginLayoutSpec.tvQrSizeDp(480))
        assertEquals(165, LoginLayoutSpec.tvQrSizeDp(540))
        assertEquals(238, LoginLayoutSpec.tvQrSizeDp(720))
        assertEquals(72, LoginLayoutSpec.tvPlaylistRowHeightDp(540))
        assertEquals(84, LoginLayoutSpec.tvPlaylistRowHeightDp(720))
    }

    @Test fun narrowPhonesKeepScannableQrWithoutOverflow() {
        assertEquals(157, LoginLayoutSpec.phoneQrSizeDp(320))
        assertEquals(180, LoginLayoutSpec.phoneQrSizeDp(360))
        assertEquals(208, LoginLayoutSpec.phoneQrSizeDp(480))
        assertTrue(LoginLayoutSpec.phoneQrSizeDp(320) < 320 - 48)
    }

    @Test fun shortTvReservesMoreWidthForActivation() {
        assertEquals(0.44f, LoginLayoutSpec.tvActivationWeight(960))
        assertEquals(0.40f, LoginLayoutSpec.tvActivationWeight(1280))
    }
}
