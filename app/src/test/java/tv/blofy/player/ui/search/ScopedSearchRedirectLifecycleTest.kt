package tv.blofy.player.ui.search

import android.app.Application
import android.content.Intent
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28], application = Application::class)
class ScopedSearchRedirectLifecycleTest {
    @Test fun aiQueryIsPreservedWhenScopedSearchIsOpened() {
        val source = Intent().apply {
            putExtra(SearchActivity.EXTRA_KIND, "series")
            putExtra(SearchActivity.EXTRA_INITIAL_QUERY, "  Stranger Things  ")
        }
        assertEquals("Stranger Things", ScopedSearchRedirectLifecycle.forwardedQuery(source))
    }

    @Test fun missingOrBlankSearchQueryNeverTriggersPhantomSearch() {
        assertNull(ScopedSearchRedirectLifecycle.forwardedQuery(Intent()))
        assertNull(ScopedSearchRedirectLifecycle.forwardedQuery(Intent().apply {
            putExtra(SearchActivity.EXTRA_INITIAL_QUERY, "   ")
        }))
    }

    @Test fun oversizedAiQueryIsBoundedWithoutBecomingEmpty() {
        val query = "Search " + "m".repeat(220)
        val source = Intent().apply { putExtra(SearchActivity.EXTRA_INITIAL_QUERY, query) }
        val result = requireNotNull(ScopedSearchRedirectLifecycle.forwardedQuery(source))
        assertEquals(120, result.length)
        assertTrue(result.startsWith("Search"))
    }
}
