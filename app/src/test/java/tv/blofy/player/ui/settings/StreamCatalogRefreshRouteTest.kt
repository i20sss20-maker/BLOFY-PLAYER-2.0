package tv.blofy.player.ui.settings

import android.app.Application
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import tv.blofy.player.ui.login.CatalogLoadingActivity

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28], application = Application::class)
class StreamCatalogRefreshRouteTest {
    private val app: Application get() = RuntimeEnvironment.getApplication()

    @Test fun settingsRefreshLoadsSameCatalogFlowAsCodeLoginWithoutRedeemingCode() {
        val intent = StreamCatalogRefreshRoute.fromSettings(app, "active-code-provider")
        assertEquals(CatalogLoadingActivity::class.java.name, intent.component?.className)
        assertEquals("active-code-provider",
            intent.getStringExtra(CatalogLoadingActivity.EXTRA_PROVIDER_ID))
        assertTrue(intent.getBooleanExtra(CatalogLoadingActivity.EXTRA_FORCE_REFRESH, false))
        assertNull(intent.getStringExtra("code"))
        assertNull(intent.getStringExtra("access_token"))
        assertNull(intent.getStringExtra("clear_session"))
    }

    @Test fun absentProviderCannotAccidentallyStartAnotherAccountImport() {
        try {
            StreamCatalogRefreshRoute.fromSettings(app, "  ".trim())
            fail("No provider must never start refresh")
        } catch (_: IllegalArgumentException) {
            // Expected.
        }
    }
}
