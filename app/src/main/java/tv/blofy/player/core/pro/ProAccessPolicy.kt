package tv.blofy.player.core.pro

/**
 * Feature-access model for the upcoming app-only PRO offering.
 *
 * A client is not an authority for purchases. [verified] must only be set from
 * an authenticated backend response after verifying the Google Play purchase.
 * Never derive it from a preference, UI action, trial checkbox, or a local
 * purchase token alone. The current app does not yet have this backend, so the
 * production default must remain [EntitlementSnapshot.FREE].
 */
enum class AppFeature(val requiresPro: Boolean) {
    PLAY_USER_M3U(false),
    PLAY_USER_XTREAM(false),
    SEARCH(false),
    FAVORITES(false),
    MULTIPLE_PLAYLISTS(true),
    CLOUD_FAVORITES(true),
    CLOUD_BACKUP(true),
    CUSTOM_THEMES(true),
    SMART_LIBRARY(true)
}

data class EntitlementSnapshot(
    val verified: Boolean,
    val active: Boolean,
    val expiresAtEpochMs: Long?,
    val isAppPro: Boolean
) {
    companion object {
        val FREE = EntitlementSnapshot(
            verified = false,
            active = false,
            expiresAtEpochMs = null,
            isAppPro = false
        )
    }
}

object ProAccessPolicy {
    fun canUse(feature: AppFeature, snapshot: EntitlementSnapshot, nowEpochMs: Long): Boolean {
        if (!feature.requiresPro) return true
        return snapshot.verified &&
            snapshot.active &&
            snapshot.isAppPro &&
            (snapshot.expiresAtEpochMs == null || snapshot.expiresAtEpochMs > nowEpochMs)
    }

    /** Current client default: purchases and entitlement verification are not available yet. */
    fun currentSnapshot(): EntitlementSnapshot = EntitlementSnapshot.FREE
}
