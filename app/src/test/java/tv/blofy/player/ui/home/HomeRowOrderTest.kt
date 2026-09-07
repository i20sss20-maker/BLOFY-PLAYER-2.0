package tv.blofy.player.ui.home

import android.app.Application
import android.view.View
import android.widget.LinearLayout
import android.widget.TextView
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28], application = Application::class)
class HomeRowOrderTest {
    private val context get() = RuntimeEnvironment.getApplication()
    private fun row(key: String, label: String) = TextView(context).apply {
        text = label
        HomeRowOrder.mark(this, key)
    }

    @Test fun localizedShelfLabelsDoNotChangeOrderOrHideMatching() {
        listOf(listOf("Recently added", "Top rated", "Quick shortcuts"),
            listOf("أضيف حديثًا", "الأعلى تقييمًا", "اختصارات سريعة")).forEach { labels ->
            val feed = LinearLayout(context)
            val hero = View(context)
            val latestTitle = row("latest", labels[0])
            val latestCards = row("latest", "Cards")
            val top = row("top_rated", labels[1])
            val quick = row(HomeRowOrder.QUICK_SHORTCUTS, labels[2])
            listOf(hero, latestTitle, latestCards, top, quick).forEach(feed::addView)
            HomeRowOrder.apply(feed, listOf("top_rated", "latest"))
            assertSame(hero, feed.getChildAt(0))
            assertSame(top, feed.getChildAt(1))
            assertSame(latestTitle, feed.getChildAt(2))
            assertSame(latestCards, feed.getChildAt(3))
            assertSame(quick, feed.getChildAt(4))
            HomeRowOrder.apply(feed, listOf("top_rated"))
            assertEquals(View.GONE, latestTitle.visibility)
            assertEquals(View.GONE, latestCards.visibility)
            assertEquals(View.VISIBLE, top.visibility)
        }
    }

    @Test fun switchingProfilesRestoresHiddenShelvesWithoutRebuildingTheirViews() {
        val feed = LinearLayout(context)
        val hero = View(context)
        val latest = row("latest", "Latest")
        val top = row("top_rated", "Top")
        listOf(hero, latest, top).forEach(feed::addView)
        HomeRowOrder.apply(feed, listOf("top_rated"))
        assertEquals(View.GONE, latest.visibility)
        assertSame(feed, latest.parent)
        HomeRowOrder.apply(feed, listOf("latest", "top_rated"))
        assertEquals(View.VISIBLE, latest.visibility)
        assertSame(latest, feed.getChildAt(1))
        assertEquals(3, feed.childCount)
    }

    @Test fun unchangedOrderDoesNotDetachRowsOrLoseCardState() {
        val feed = LinearLayout(context)
        val hero = View(context)
        val latest = row("latest", "Latest").apply { scrollTo(42, 0) }
        listOf(hero, latest).forEach(feed::addView)
        repeat(5) { HomeRowOrder.apply(feed, listOf("latest")) }
        assertSame(latest, feed.getChildAt(1))
        assertEquals(42, latest.scrollX)
    }

    @Test fun existingShelfPrefixesMapToSavedProfileKeys() {
        assertEquals("continue_watching", HomeRowOrder.shelfKey("continue"))
        assertEquals("recent_channels", HomeRowOrder.shelfKey("recent"))
        assertEquals("top_rated", HomeRowOrder.shelfKey("top"))
        assertEquals("uhd", HomeRowOrder.shelfKey("4k"))
        assertEquals("latest", HomeRowOrder.shelfKey("latest"))
    }
}
