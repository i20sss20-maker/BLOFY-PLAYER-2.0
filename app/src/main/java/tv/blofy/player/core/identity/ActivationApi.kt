package tv.blofy.player.core.identity

import retrofit2.http.Body
import retrofit2.http.POST

data class ActivationCheckRequest(
    val deviceId: String,
    val activationCode: String,
    val appVersion: String,
    val platform: String = "android"
)

data class ActivationCheckResponse(
    val status: String,
    val expiresAt: Long? = null,
    val serverTime: Long? = null,
    val message: String? = null
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
}
