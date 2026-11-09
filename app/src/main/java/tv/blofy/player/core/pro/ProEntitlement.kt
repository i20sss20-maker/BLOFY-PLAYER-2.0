package tv.blofy.player.core.pro

/**
 * BLOFY PLAYER app-only PRO access contract. This is intentionally independent
 * from legacy device activation or any BLOFY STREAM media subscription.
 *
 * Until purchases are verified by a backend, [current] always returns FREE.
 * No locally stored flag, pairing code or purchase callback can grant PRO.
 */
enum class ProFeature {
    MULTIPLE_PLAYLISTS,
    CLOUD_FAVORITES,
    CLOUD_BACKUP,
    CUSTOM_THEMES,
    SMART_LIBRARY
}

data class ProEntitlement(
    val verifiedByServer: Boolean,
    val active: Boolean,
    val expiresAtMs: Long?,
    val productId: String?
)

object ProAccess {
    private const val PRODUCT = "blofy_player_pro"
    val FREE = ProEntitlement(false, false, null, null)

    fun current(): ProEntitlement = FREE

    fun canUse(feature: ProFeature, entitlement: ProEntitlement, nowMs: Long): Boolean {
        // A feature enum here represents only *planned* app premium features.
        // It does not gate existing free playback, Xtream/M3U, search or favorites.
        return feature in ProFeature.values() &&
            entitlement.verifiedByServer &&
            entitlement.active &&
            entitlement.productId == PRODUCT &&
            (entitlement.expiresAtMs == null || entitlement.expiresAtMs > nowMs)
    }
}
