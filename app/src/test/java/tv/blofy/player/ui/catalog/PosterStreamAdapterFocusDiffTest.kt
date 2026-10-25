package tv.blofy.player.ui.catalog

import android.app.Application
import androidx.recyclerview.widget.RecyclerView
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import tv.blofy.player.data.local.StreamEntity

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28], application = Application::class)
class PosterStreamAdapterFocusDiffTest {
    @Test fun metadataRefreshKeepsStableDpadCardsAndDoesNotRedrawEntireGrid() {
        val adapter = PosterStreamAdapter(onClick = {})
        val events = mutableListOf<String>()
        adapter.registerAdapterDataObserver(object : RecyclerView.AdapterDataObserver() {
            override fun onChanged() { events.add("full") }
            override fun onItemRangeChanged(positionStart: Int, itemCount: Int) {
                events.add("range:$positionStart:$itemCount")
            }
        })
        fun item(index: Int, name: String) =
            StreamEntity("p:movie:$index", "p", "$index", "movies", "movie", name)
        val original = (0 until 18).map { item(it, "Movie $it") }
        adapter.replace(original)
        assertEquals(listOf("full"), events)
        events.clear()
        adapter.replace(original)
        assertTrue("An identical catalog snapshot must not rebind any card", events.isEmpty())
        adapter.replace(original.mapIndexed { i, stream ->
            if (i == 7) item(i, "Corrected movie name") else stream
        })
        assertEquals(listOf("range:7:1"), events)
        events.clear()
        val reordered = original.reversed()
        adapter.replace(reordered)
        assertEquals(listOf("full"), events)
    }
}
