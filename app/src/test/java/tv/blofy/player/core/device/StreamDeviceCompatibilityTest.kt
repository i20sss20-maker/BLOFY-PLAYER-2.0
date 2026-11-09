package tv.blofy.player.core.device

import org.junit.Assert.*
import org.junit.Test

class StreamDeviceCompatibilityTest {
    @Test fun android7TelevisionLimitsMemoryAndCatalogConcurrency() {
        val p = StreamDeviceCompatibility.classify(sdk = 24, television = true, lowMemory = false)
        assertTrue(p.legacyAndroid)
        assertTrue(p.lowMemory)
        assertEquals(2, p.maxCatalogRequestsPerHost)
        assertEquals("Media3", p.engine)
        assertTrue(p.decoderFallback)
        assertTrue(p.playerMaxBufferMs > p.playerMinBufferMs)
    }

    @Test fun android9TelevisionGetsLongerTlsConnectionWindow() {
        val p = StreamDeviceCompatibility.classify(sdk = 28, television = true, lowMemory = false)
        assertEquals(15L, p.connectTimeoutSeconds)
        assertEquals(45L, p.readTimeoutSeconds)
        assertEquals(16 * 1024 * 1024, p.playerTargetBufferBytes)
    }

    @Test fun modernAndroidTvDoesNotInheritOldFirmwareLimits() {
        val p = StreamDeviceCompatibility.classify(sdk = 36, television = true, lowMemory = false)
        assertFalse(p.legacyAndroid)
        assertFalse(p.lowMemory)
        assertEquals(4, p.maxCatalogRequestsPerHost)
        assertEquals(32 * 1024 * 1024, p.playerTargetBufferBytes)
    }

    @Test fun modernLowRamPhoneStillUsesBoundedBuffers() {
        val p = StreamDeviceCompatibility.classify(sdk = 35, television = false, lowMemory = true)
        assertTrue(p.lowMemory)
        assertEquals(2, p.maxCatalogRequestsPerHost)
    }

    @Test fun newPhoneUsesFullConcurrency() {
        assertEquals(6, StreamDeviceCompatibility.classify(36, false, false).maxCatalogRequestsPerHost)
    }
}
