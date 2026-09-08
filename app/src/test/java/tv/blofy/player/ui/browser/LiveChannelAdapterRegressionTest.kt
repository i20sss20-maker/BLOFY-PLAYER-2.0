package tv.blofy.player.ui.browser

import org.junit.Assert.assertEquals
import org.junit.Test
import tv.blofy.player.data.local.StreamEntity

class LiveChannelAdapterRegressionTest {
    private fun stream(name: String, locked: Boolean = false, icon: String? = null) = StreamEntity(
        key = "p1:live:10",
        providerId = "p1",
        remoteId = "10",
        categoryId = "1",
        kind = "live",
        name = name,
        icon = icon,
        locked = locked,
    )

    @Test fun sameStableIdStillAcceptsChangedMetadata() {
        val adapter = LiveChannelAdapter(
            onClick = {},
            onFocus = {},
            onLongClick = {},
            itemKey = { it.key },
        )
        adapter.replace(listOf(stream("Old name", locked = false, icon = "https://old.example/logo.png")))
        adapter.replace(listOf(stream("New name", locked = true, icon = "https://new.example/logo.png")))

        val current = adapter.itemAt(0)!!
        assertEquals("New name", current.name)
        assertEquals(true, current.locked)
        assertEquals("https://new.example/logo.png", current.icon)
    }

    @Test fun identicalSnapshotRemainsStable() {
        val adapter = LiveChannelAdapter({}, {}, {}, { it.key })
        val same = stream("Same")
        adapter.replace(listOf(same))
        adapter.replace(listOf(same.copy()))
        assertEquals(1, adapter.itemCount)
        assertEquals("Same", adapter.itemAt(0)?.name)
    }
}
