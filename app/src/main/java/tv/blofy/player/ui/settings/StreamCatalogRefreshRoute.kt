package tv.blofy.player.ui.settings

import android.content.Context
import android.content.Intent
import tv.blofy.player.ui.login.CatalogLoadingActivity

/**
 * Re-use the original verified code-login catalog loading screen to refresh
 * an existing subscriber. No login activity, code redemption, activation or
 * clearing the saved library is part of this navigation.
 */
internal object StreamCatalogRefreshRoute {
    fun fromSettings(context: Context, providerId: String): Intent {
        require(providerId.isNotBlank()) { "Active provider required" }
        return Intent(context, CatalogLoadingActivity::class.java).apply {
            putExtra(CatalogLoadingActivity.EXTRA_PROVIDER_ID, providerId)
            putExtra(CatalogLoadingActivity.EXTRA_FORCE_REFRESH, true)
        }
    }
}
