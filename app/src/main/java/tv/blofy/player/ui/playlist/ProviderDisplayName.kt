package tv.blofy.player.ui.playlist

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
        "BLOFY Subscriber",
        "BLOFY Playlist"
    )

    fun forUi(provider: ProviderEntity): String {
        val savedName = provider.name.trim()
        return if (legacyNames.any { it.equals(savedName, ignoreCase = true) }) "STROING 8K"
        else savedName
    }
}
