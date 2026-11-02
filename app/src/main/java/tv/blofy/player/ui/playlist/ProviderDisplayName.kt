package tv.blofy.player.ui.playlist

import tv.blofy.player.core.identity.BlofySubscriberClient
import tv.blofy.player.data.local.ProviderEntity

/**
 * Branding only: never rewrite saved Xtream credentials, host URLs, IDs or custom labels.
 * The old BLOFY subscriber account is now branded STROING 8K in the UI.
 */
object ProviderDisplayName {
    private val legacyNames = setOf(
        "مشتركين BLOFY",
        "مشتركو BLOFY",
        "BLOFY Subscribers",
        "BLOFY Subscriber"
    )

    fun forUi(provider: ProviderEntity): String {
        val savedName = provider.name.trim()
        val isSubscriberBrand = legacyNames.any { it.equals(savedName, ignoreCase = true) }
        val oldDefault = savedName.equals("BLOFY Playlist", ignoreCase = true) &&
            BlofySubscriberClient.isManaged(provider)
        return if (isSubscriberBrand || oldDefault) "STROING 8K" else savedName
    }
}
