package tv.blofy.player.ui.search

import android.app.Application
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import tv.blofy.player.data.local.StreamEntity
import tv.blofy.player.ui.details.MovieDetailsActivity
import tv.blofy.player.ui.details.SeriesDetailsActivity

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28], application = Application::class)
class AiResultNavigationTest {
    private val context: Application = RuntimeEnvironment.getApplication()
    private fun item(kind: String, locked: Boolean = false) = StreamEntity(
        key = "provider-a:$kind:123", providerId = "provider-a",
        remoteId = "123", categoryId = null, kind = kind,
        name = "Film Title", locked = locked
    )

    @Test fun verifiedMovieOpensItsExactDetailsRatherThanEmptySearch() {
        val movie = item("movie")
        val intent = requireNotNull(AiResultNavigation.details(context, movie))
        assertEquals(MovieDetailsActivity::class.java.name, intent.component?.className)
        assertEquals(movie.key, intent.getStringExtra(MovieDetailsActivity.EXTRA_CONTENT_KEY))
        assertEquals(movie.providerId, intent.getStringExtra(MovieDetailsActivity.EXTRA_PROVIDER_ID))
    }

    @Test fun verifiedSeriesOpensItsExactSeriesDetails() {
        val series = item("series")
        val intent = requireNotNull(AiResultNavigation.details(context, series))
        assertEquals(SeriesDetailsActivity::class.java.name, intent.component?.className)
        assertEquals(series.key, intent.getStringExtra(SeriesDetailsActivity.EXTRA_CONTENT_KEY))
        assertEquals(series.providerId, intent.getStringExtra(SeriesDetailsActivity.EXTRA_PROVIDER_ID))
    }

    @Test fun lockedOrNonCatalogRowsCannotBeOpenedAsMovie() {
        assertNull(AiResultNavigation.details(context, item("movie", locked = true)))
        assertNull(AiResultNavigation.details(context, item("live")))
        assertNull(AiResultNavigation.details(context, item("unknown")))
    }

    @Test fun searchFallbackAlwaysCarriesTheSelectedTitle() {
        val intent = requireNotNull(AiResultNavigation.search(context, "  [4K] Film Title (2024)  "))
        assertEquals(SearchActivity::class.java.name, intent.component?.className)
        assertEquals("[4K] Film Title (2024)", intent.getStringExtra(SearchActivity.EXTRA_INITIAL_QUERY))
        assertNull(intent.getStringExtra(SearchActivity.EXTRA_KIND))
        assertNull(AiResultNavigation.search(context, "   "))
    }
}
