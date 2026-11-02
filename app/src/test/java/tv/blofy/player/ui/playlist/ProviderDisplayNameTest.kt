package tv.blofy.player.ui.playlist

import org.junit.Assert.assertEquals
import org.junit.Test
import tv.blofy.player.data.local.ProviderEntity

class ProviderDisplayNameTest {
    private fun provider(name: String) = ProviderEntity(
        id = "test-provider",
        name = name,
        baseUrl = "https://old-host.example",
        username = "existing-user",
        password = "existing-password"
    )

    @Test fun legacySubscriberNamesAreRebrandedWithoutChangingConnection() {
        for (name in listOf("مشتركين BLOFY", "مشتركو BLOFY", "BLOFY Subscribers")) {
            val original = provider(name)
            assertEquals("STROING 8K", ProviderDisplayName.forUi(original))
            assertEquals("https://old-host.example", original.baseUrl)
            assertEquals("existing-user", original.username)
            assertEquals("existing-password", original.password)
        }
    }

    @Test fun customerNamesAndManualXtreamRemainUntouched() {
        assertEquals("My Xtream", ProviderDisplayName.forUi(provider("My Xtream")))
        assertEquals("Family TV", ProviderDisplayName.forUi(provider("Family TV")))
        assertEquals("BLOFY Playlist", ProviderDisplayName.forUi(provider("BLOFY Playlist")))
        assertEquals("STROING 8K", ProviderDisplayName.forUi(provider("BLOFY Playlist").copy(subscriberToken = "old-token")))
    }
}
