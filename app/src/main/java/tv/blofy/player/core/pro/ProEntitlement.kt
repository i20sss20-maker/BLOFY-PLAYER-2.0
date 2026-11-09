package tv.blofy.player.core.pro

/**
 * BLOFY PLAYER app-only annual plans. Commercial prices are informational:
 * Google Play remains the sole authority for localized checkout prices.
 * This is separate from BLOFY STREAM media subscriptions and legacy activation.
 */
enum class PlayerPlan(val annualPriceSar: Int, val productId: String?) {
    FREE(0, null),
    PRO(19, "blofy_player_pro"),
    VIP(49, "blofy_player_vip");

    val isAnnualPaidPlan: Boolean get() = this != FREE
}

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
    val FREE = ProEntitlement(false, false, null, null)

    /** Until server-side Google Play verification exists, this stays FREE. */
    fun current(): ProEntitlement = FREE

    fun verifiedPlan(entitlement: ProEntitlement, nowMs: Long): PlayerPlan {
        if (!entitlement.verifiedByServer || !entitlement.active ||
            (entitlement.expiresAtMs != null && entitlement.expiresAtMs <= nowMs)) return PlayerPlan.FREE
        return PlayerPlan.values().firstOrNull {
            it.isAnnualPaidPlan && it.productId == entitlement.productId
        } ?: PlayerPlan.FREE
    }

    fun canUse(feature: ProFeature, entitlement: ProEntitlement, nowMs: Long): Boolean {
        // Only future premium features should consult this policy.
        // Existing Xtream/M3U playback, search, favorites and legacy subscriber access remain unchanged.
        return feature in ProFeature.values() && verifiedPlan(entitlement, nowMs) != PlayerPlan.FREE
    }
}
