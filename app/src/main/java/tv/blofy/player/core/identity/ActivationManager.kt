package tv.blofy.player.core.identity

import android.content.Context
import tv.blofy.player.data.local.ActivationEntity
import tv.blofy.player.data.local.BlofyDao

class ActivationManager(
    private val context: Context,
    private val dao: BlofyDao
) {
    suspend fun ensureIdentity(): ActivationEntity {
        val desiredDeviceId = DeviceIdentity.deviceId(context)
        val existing = dao.activation()
        if (existing != null) {
            // rc04 and older derived the Device ID from ANDROID_ID. After an uninstall the
            // random activation code was lost while the deterministic Device ID returned,
            // colliding with the old server credential. Move an upgraded installation to the
            // new installation-scoped ID once, while preserving its visible six-digit code.
            if (existing.deviceId != desiredDeviceId) {
                val migrated = existing.copy(
                    deviceId = desiredDeviceId,
                    activated = false,
                    expiresAt = null,
                    lastCheckAt = System.currentTimeMillis()
                )
                dao.replaceActivation(migrated)
                return migrated
            }

            val reconciledCode = DeviceIdentity.reconcileExistingActivationCode(context, existing.activationCode)
            if (reconciledCode == existing.activationCode) return existing
            return existing.copy(activationCode = reconciledCode).also { dao.upsertActivation(it) }
        }
        val created = ActivationEntity(
            deviceId = desiredDeviceId,
            activationCode = DeviceIdentity.activationCode(context),
            lastCheckAt = System.currentTimeMillis()
        )
        dao.upsertActivation(created)
        return created
    }

    suspend fun refresh(api: ActivationApi, appVersion: String): ActivationCheckResponse {
        var current = ensureIdentity()
        // Retry a possibly-committed rotation before checking the old code. The
        // server endpoint is idempotent for this exact old/new pair.
        current = rotatePendingCode(api, current) ?: current
        val response = api.check(
            ActivationCheckRequest(
                deviceId = current.deviceId,
                activationCode = current.activationCode,
                appVersion = appVersion
            )
        )
        if (response.canUse()) rotatePendingCode(api, current)
        applyRemoteStatus(response.canUse(), response.expiresAt)
        return response
    }

    private suspend fun rotatePendingCode(api: ActivationApi, current: ActivationEntity): ActivationEntity? {
        val pending = DeviceIdentity.pendingActivationCode(context) ?: return null
        if (pending == current.activationCode) {
            DeviceIdentity.commitActivationCodeRotation(context, pending)
            return current
        }
        val response = runCatching {
            api.rotate(
                ActivationRotateRequest(
                    deviceId = current.deviceId,
                    currentActivationCode = current.activationCode,
                    newActivationCode = pending
                )
            )
        }.getOrNull() ?: return null
        if (!response.rotated) return null

        val updated = current.copy(activationCode = pending)
        dao.upsertActivation(updated)
        DeviceIdentity.commitActivationCodeRotation(context, pending)
        return updated
    }

    suspend fun applyRemoteStatus(activated: Boolean, expiresAt: Long?): ActivationEntity {
        val current = ensureIdentity()
        val updated = current.copy(
            activated = activated,
            expiresAt = expiresAt,
            lastCheckAt = System.currentTimeMillis()
        )
        dao.upsertActivation(updated)
        return updated
    }

    fun cachedCanUse(state: ActivationEntity, nowMs: Long = System.currentTimeMillis()): Boolean {
        if (!state.activated) return false
        return state.expiresAt == null || state.expiresAt > nowMs
    }
}
