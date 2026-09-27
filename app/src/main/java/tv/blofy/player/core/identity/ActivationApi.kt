package tv.blofy.player.core.identity

import retrofit2.http.Body
import retrofit2.http.POST

data class ActivationCheckRequest(
    val deviceId: String,
    val activationCode: String,
    val appVersion: String,
    val platform: String = "android",
    val trialScope: String? = null
)

data class ActivationRotateRequest(
    val deviceId: String,
    val currentActivationCode: String,
    val newActivationCode: String
)

data class ActivationRotateResponse(val rotated: Boolean)

data class ActivationIdentityMigrationRequest(
    val deviceId: String,
    val activationCode: String,
    val targetDeviceId: String,
    val targetActivationCode: String
)

data class ActivationIdentityMigrationResponse(
    val migrated: Boolean = false,
    val alreadyStable: Boolean = false,
    val aliasBound: Boolean = false,
    val deviceId: String? = null
)

data class ActivationCheckResponse(
    val status: String,
    val expiresAt: Long? = null,
    val serverTime: Long? = null,
    val message: String? = null,
    val canonicalDeviceId: String? = null,
    val recovered: Boolean = false
) {
    enum class State { TRIAL, ACTIVE, EXPIRED, BLOCKED, UNKNOWN }

    fun state(): State = when (status.lowercase()) {
        "trial" -> State.TRIAL
        "active" -> State.ACTIVE
        "expired" -> State.EXPIRED
        "blocked" -> State.BLOCKED
        else -> State.UNKNOWN
    }

    fun canUse(nowMs: Long = serverTime ?: System.currentTimeMillis()): Boolean = when (state()) {
        State.TRIAL, State.ACTIVE -> expiresAt == null || expiresAt > nowMs
        else -> false
    }
}

interface ActivationApi {
    @POST("api/v1/activation/check")
    suspend fun check(@Body request: ActivationCheckRequest): ActivationCheckResponse

    @POST("api/v1/activation/rotate")
    suspend fun rotate(@Body request: ActivationRotateRequest): ActivationRotateResponse

    @POST("api/v1/device/identity/migrate")
    suspend fun migrateIdentity(
        @Body request: ActivationIdentityMigrationRequest
    ): ActivationIdentityMigrationResponse
}
