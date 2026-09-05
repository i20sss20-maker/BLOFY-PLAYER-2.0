package tv.blofy.player.core.device

import org.junit.Assert.assertEquals
import org.junit.Test

class DeviceClassTest {
    @Test fun explicitTvUiModeWins() {
        assertEquals(DeviceClass.Kind.TV, DeviceClass.classify(true, false, false, false, 360))
    }

    @Test fun leanbackBoxIsTvEvenWhenVendorReportsNormalUiMode() {
        assertEquals(DeviceClass.Kind.TV, DeviceClass.classify(false, true, false, false, 540))
    }

    @Test fun televisionFeatureIsTv() {
        assertEquals(DeviceClass.Kind.TV, DeviceClass.classify(false, false, true, false, 720))
    }

    @Test fun remoteOnlyReceiverIsTv() {
        assertEquals(DeviceClass.Kind.TV, DeviceClass.classify(false, false, false, true, 480))
    }

    @Test fun touchTabletRemainsTablet() {
        assertEquals(DeviceClass.Kind.TABLET, DeviceClass.classify(false, false, false, false, 800))
    }

    @Test fun phoneRemainsPhone() {
        assertEquals(DeviceClass.Kind.PHONE, DeviceClass.classify(false, false, false, false, 411))
    }
}
