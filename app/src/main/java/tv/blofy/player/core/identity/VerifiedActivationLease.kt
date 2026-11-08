package tv.blofy.player.core.identity

import android.content.Context
import android.os.SystemClock
import android.os.Build
import android.provider.Settings
import tv.blofy.player.data.local.ActivationEntity

/**
 * A successful activation/check supplies the server's authoritative time.
 *
 * The device wall clock can be very wrong on Android 9 TV boxes. Keep a
 * short, bounded lease using elapsedRealtime() within the same boot instead
 * of reinterpreting a server expiry using that untrusted wall clock.
 * A reboot or an identity/expiry mismatch invalidates this hint; the
 * activation API remains the source of truth.
 */
internal object VerifiedActivationLease {
    private const val PREFS = "blofy_verified_activation_lease_v1"
    private const val MISSING = -1L

    fun record(context: Context, identity: ActivationEntity, response: ActivationCheckResponse) {
        val prefs = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val serverTime = response.serverTime
        val boot = bootCount(context)
        if (!identity.activated || serverTime == null || serverTime <= 0L || boot < 0 || !response.canUse()) {
            prefs.edit().clear().apply()
            return
        }
        prefs.edit()
            .putString("device", identity.deviceId)
            .putString("code", identity.activationCode)
            .putLong("expires", identity.expiresAt ?: MISSING)
            .putLong("server_time", serverTime)
            .putLong("elapsed_at", SystemClock.elapsedRealtime())
            .putInt("boot", boot)
            .apply()
    }

    /** Returns null if no matching server-time proof was recorded. */
    fun allows(context: Context, identity: ActivationEntity): Boolean? {
        val prefs = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        if (!prefs.contains("elapsed_at")) return null
        val currentBoot = bootCount(context)
        if (currentBoot < 0 || prefs.getInt("boot", -1) != currentBoot) return false
        if (prefs.getString("device", null) != identity.deviceId ||
            prefs.getString("code", null) != identity.activationCode ||
            prefs.getLong("expires", MISSING) != (identity.expiresAt ?: MISSING)) return false
        return allowsAt(
            identity,
            prefs.getLong("server_time", MISSING),
            prefs.getLong("elapsed_at", MISSING),
            SystemClock.elapsedRealtime()
        )
    }

    private fun bootCount(context: Context): Int {
        if (Build.VERSION.SDK_INT < 24) return -1
        return runCatching {
            Settings.Global.getInt(context.applicationContext.contentResolver, Settings.Global.BOOT_COUNT, -1)
        }.getOrDefault(-1)
    }

    internal fun allowsAt(
        identity: ActivationEntity,
        serverTime: Long,
        verifiedAtElapsed: Long,
        nowElapsed: Long
    ): Boolean {
        val elapsed = nowElapsed - verifiedAtElapsed
        // A reboot resets elapsedRealtime. Never interpret a reset as free time.
        if (!identity.activated || serverTime <= 0L || verifiedAtElapsed < 0L ||
            elapsed !in 0L..ActivationLease.OFFLINE_GRACE_MS) return false
        val estimatedServerTime = serverTime + elapsed
        return identity.expiresAt == null || identity.expiresAt > estimatedServerTime
    }
}
