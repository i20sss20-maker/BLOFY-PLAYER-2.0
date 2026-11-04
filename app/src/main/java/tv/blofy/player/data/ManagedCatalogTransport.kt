package tv.blofy.player.data

import tv.blofy.player.core.identity.BlofySubscriberClient
import tv.blofy.player.data.local.ProviderEntity

/**
 * Managed BLOFY subscribers use the authenticated HTTPS gateway for the
 * enormous Live/VOD/Series catalog. Older working clients used this gateway;
 * newer direct-origin imports are prone to truncated upstream responses.
 *
 * The gateway is an ephemeral CATALOG route only: never persist this source
 * as the account's login or media-playback host. If the gateway cannot serve
 * a complete catalog, the direct origin is the one bounded fallback.
 *
 * Ordinary user-entered Xtream sources are unaffected.
 */
internal object ManagedCatalogTransport {
    fun candidates(provider: ProviderEntity, activationBaseUrl: String): List<ProviderEntity> {
        if (provider.subscriberToken.isBlank()) return listOf(provider)
        val gateway = BlofySubscriberClient.portalSource(provider, activationBaseUrl)
        return if (gateway.baseUrl == provider.baseUrl &&
            gateway.username == provider.username) listOf(provider)
        else listOf(gateway, provider)
    }
}
