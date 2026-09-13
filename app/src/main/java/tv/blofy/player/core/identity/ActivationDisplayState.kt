package tv.blofy.player.core.identity

import android.content.Context
import tv.blofy.player.data.local.ActivationEntity

/** Presentation only. Access decisions remain in ActivationManager and the server. */
object ActivationDisplayState {
    private const val PREFS = "blofy_activation_display_v1"

    data class Snapshot(val state: ActivationCheckResponse.State, val expiresAt: Long?, val clockOffset: Long = 0L, val trial: Boolean = state == ActivationCheckResponse.State.TRIAL) {
        fun remainingMinutes(now: Long): Long? = expiresAt?.let {
            val remaining = it - (now + clockOffset)
            if (remaining <= 0L) 0L else (remaining + 59_999L) / 60_000L
        }
    }

    fun record(context: Context, identity: ActivationEntity, response: ActivationCheckResponse) {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val wasTrial = prefs.getString("device", null) == identity.deviceId && prefs.getBoolean("trial", false)
        val trial = response.state() == ActivationCheckResponse.State.TRIAL ||
            (response.state() == ActivationCheckResponse.State.EXPIRED && wasTrial)
        prefs.edit()
            .putBoolean("trial", trial)
            .putString("device", identity.deviceId)
            .putString("state", response.state().name)
            .putLong("expires", response.expiresAt ?: -1L)
            .putLong("clock_offset", (response.serverTime ?: System.currentTimeMillis()) - System.currentTimeMillis())
            .apply()
    }

    fun read(context: Context, identity: ActivationEntity): Snapshot {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        if (prefs.getString("device", null) == identity.deviceId &&
            prefs.getLong("expires", -1L) == (identity.expiresAt ?: -1L)) {
            val state = runCatching { ActivationCheckResponse.State.valueOf(prefs.getString("state", "UNKNOWN")!!) }
                .getOrDefault(ActivationCheckResponse.State.UNKNOWN)
            return Snapshot(state, identity.expiresAt, prefs.getLong("clock_offset", 0L), prefs.getBoolean("trial", state == ActivationCheckResponse.State.TRIAL))
        }
        // Older releases did not retain trial vs paid status. Do not call a paid plan a trial.
        return Snapshot(when {
            identity.activated -> ActivationCheckResponse.State.ACTIVE
            identity.expiresAt != null -> ActivationCheckResponse.State.EXPIRED
            else -> ActivationCheckResponse.State.UNKNOWN
        }, identity.expiresAt)
    }
}
