package tv.blofy.player.core.playback

import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test
import tv.blofy.player.data.local.StreamEntity

class SmartZappingCacheTest {
    @Before
    fun setUp() {
        SmartZappingCache.clear()
    }

    @After
    fun tearDown() {
        SmartZappingCache.clear()
    }

    @Test
    fun adjacentWrapsInBothDirections() {
        SmartZappingCache.put(PROVIDER, CATEGORY, channels("1", "2", "3"))

        assertEquals(
            "1",
            SmartZappingCache.adjacent(PROVIDER, CATEGORY, "3", 1)?.remoteId
        )
        assertEquals(
            "3",
            SmartZappingCache.adjacent(PROVIDER, CATEGORY, "1", -1)?.remoteId
        )
        assertEquals(
            "3",
            SmartZappingCache.adjacent(PROVIDER, CATEGORY, "1", 5)?.remoteId
        )
    }

    @Test
    fun channelNumberIsOneBasedAndBounded() {
        SmartZappingCache.put(PROVIDER, CATEGORY, channels("10", "20", "30"))

        assertEquals(
            "20",
            SmartZappingCache.byNumber(PROVIDER, CATEGORY, 2)?.remoteId
        )
        assertNull(SmartZappingCache.byNumber(PROVIDER, CATEGORY, 0))
        assertNull(SmartZappingCache.byNumber(PROVIDER, CATEGORY, 4))
    }

    @Test
    fun exposesCurrentPositionForHud() {
        SmartZappingCache.put(PROVIDER, CATEGORY, channels("a", "b", "c"))

        val position = SmartZappingCache.position(PROVIDER, CATEGORY, "b")

        assertEquals(2, position?.number)
        assertEquals(3, position?.total)
        assertNull(SmartZappingCache.position(PROVIDER, CATEGORY, "missing"))
    }

    @Test
    fun providerInvalidationDoesNotClearOtherProviders() {
        SmartZappingCache.put(PROVIDER, CATEGORY, channels("1", "2"))
        SmartZappingCache.put("provider-2", CATEGORY, channels("7", "8", providerId = "provider-2"))

        SmartZappingCache.invalidate(PROVIDER)

        assertNull(SmartZappingCache.byNumber(PROVIDER, CATEGORY, 1))
        assertEquals(
            "7",
            SmartZappingCache.byNumber("provider-2", CATEGORY, 1)?.remoteId
        )
    }

    private fun channels(
        vararg ids: String,
        providerId: String = PROVIDER
    ): List<StreamEntity> = ids.map { id ->
        StreamEntity(
            key = "$providerId:live:$id",
            providerId = providerId,
            remoteId = id,
            categoryId = CATEGORY,
            kind = "live",
            name = "Channel $id"
        )
    }

    private companion object {
        const val PROVIDER = "provider-1"
        const val CATEGORY = "sports"
    }
}
