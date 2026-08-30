package tv.blofy.player.core.identity

import android.content.Context
import tv.blofy.player.data.local.ActivationEntity
import tv.blofy.player.data.local.BlofyDao

class ActivationManager(
    private val context: Context,
    private val dao: BlofyDao
) {
    suspend fun ensureIdentity(): ActivationEntity {
        val existing = dao.activation()
        if (existing != null) return existing
        val created = ActivationEntity(
            deviceId = DeviceIdentity.deviceId(context),
            activationCode = DeviceIdentity.activationCode(context),
            lastCheckAt = System.currentTimeMillis()
        )
        dao.upsertActivation(created)
        return created
    }

    suspend fun refresh(api: ActivationApi, appVersion: String): ActivationCheckResponse {
        val current = ensureIdentity()
        val response = api.check(
            ActivationCheckRequest(
                deviceId = current.deviceId,
                activationCode = current.activationCode,
                appVersion = appVersion
            )
        )
        applyRemoteStatus(response.canUse(), response.expiresAt)
        return response
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
