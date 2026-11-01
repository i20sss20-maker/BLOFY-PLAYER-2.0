package tv.blofy.player.core.identity

import android.content.Context
import kotlinx.coroutines.CancellationException
import tv.blofy.player.data.local.ActivationEntity
import tv.blofy.player.data.local.BlofyDao

class ActivationManager(
    private val context: Context,
    private val dao: BlofyDao
) {
    suspend fun ensureIdentity(): ActivationEntity {
        val existing = dao.activation()
        if (existing != null) {
            // An upgraded install must keep its server-issued identity until Azure atomically
            // migrates that row. Room is authoritative here; never invent a local-only Device ID.
            DeviceIdentity.preserveExistingDeviceId(context, existing.deviceId)
            val reconciledCode = DeviceIdentity.reconcileExistingActivationCode(context, existing.activationCode)
            if (reconciledCode == existing.activationCode) return existing
            return existing.copy(activationCode = reconciledCode).also { dao.upsertActivation(it) }
        }

        val created = ActivationEntity(
            deviceId = DeviceIdentity.deviceId(context),
            activationCode = DeviceIdentity.activationCode(context),
            lastCheckAt = System.currentTimeMillis()
        )
        dao.upsertActivation(created)
        return created
    }

    /**
     * Binds the deterministic reinstall identity as a recovery alias for an already-issued device.
     * A normal app update keeps the visible/server device ID unchanged. If we ever talk to an older
     * backend that actually migrated the row, the legacy response is still handled for compatibility.
     */
    suspend fun migrateStableIdentityIfNeeded(
        api: ActivationApi,
        current: ActivationEntity? = null
    ): ActivationEntity {
        val resolved = current ?: ensureIdentity()
        val stable = DeviceIdentity.stableIdentity(context) ?: return resolved
        val targetDeviceId = stable.first
        val targetActivationCode = stable.second
        if (resolved.deviceId == targetDeviceId) return resolved
        if (DeviceIdentity.stableAliasAlreadyBound(context, resolved.deviceId)) return resolved

        val response = api.migrateIdentity(
            ActivationIdentityMigrationRequest(
                deviceId = resolved.deviceId,
                activationCode = resolved.activationCode,
                targetDeviceId = targetDeviceId,
                targetActivationCode = targetActivationCode
            )
        )

        if (response.aliasBound) {
            if (response.deviceId != null && response.deviceId != resolved.deviceId) return resolved
            DeviceIdentity.markStableAliasBound(context, resolved.deviceId)
            return resolved
        }

        // Compatibility with a short-lived older backend contract that moved the canonical row.
        if (!response.migrated && !response.alreadyStable) return resolved
        if (response.deviceId != null && response.deviceId != targetDeviceId) return resolved
        val migrated = resolved.copy(
            deviceId = targetDeviceId,
            activationCode = targetActivationCode,
            lastCheckAt = System.currentTimeMillis()
        )
        dao.replaceActivation(migrated)
        DeviceIdentity.commitStableIdentity(context, targetDeviceId, targetActivationCode)
        return migrated
    }

    suspend fun refresh(api: ActivationApi, appVersion: String): ActivationCheckResponse {
        var current = ensureIdentity()
        current = try {
            migrateStableIdentityIfNeeded(api, current)
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (_: Exception) {
            // Identity migration is an upgrade aid, never a prerequisite for playback.
            // If the backend is temporarily older/unavailable, keep the already-authorized
            // device identity and continue the normal activation check.
            current
        }
        // Retry a possibly-committed rotation before checking the old code. The
        // server endpoint is idempotent for this exact old/new pair.
        current = rotatePendingCode(api, current) ?: current
        val response = api.check(
            ActivationCheckRequest(
                deviceId = current.deviceId,
                activationCode = current.activationCode,
                appVersion = appVersion,
                trialScope = TrialIdentity.scope(context)
            )
        )

        val canonical = response.canonicalDeviceId
            ?.takeIf { it.isNotBlank() && it != current.deviceId }
        if (canonical != null) {
            DeviceIdentity.adoptRecoveredCanonicalIdentity(context, canonical, current.activationCode)
            current = current.copy(
                deviceId = canonical,
                lastCheckAt = System.currentTimeMillis()
            )
            dao.replaceActivation(current)
        }

        if (response.canUse()) rotatePendingCode(api, current)
        val updated = applyRemoteStatus(response.canUse(), response.expiresAt)
        ActivationDisplayState.record(context, updated, response)
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
        return ActivationLease.allows(state, nowMs)
    }
}
