package tv.blofy.player.core.identity

import okhttp3.HttpUrl.Companion.toHttpUrlOrNull

/** Builds the public activation-portal URL encoded by the login-screen QR code. */
object ActivationPortalUrl {
    fun create(baseUrl: String, deviceId: String, activationCode: String): String? {
        val normalizedDeviceId = deviceId.trim()
        val normalizedCode = activationCode.trim()
        if (normalizedDeviceId.isBlank() || !normalizedCode.matches(Regex("[0-9]{6}"))) return null

        val activationEndpoint = baseUrl.trim().toHttpUrlOrNull() ?: return null
        if (!activationEndpoint.isHttps) return null

        // The API and portal share the same production origin. Resolving `/` avoids
        // accidentally encoding an API path or stale query from the build setting.
        val portal = activationEndpoint.resolve("/") ?: return null
        val activationFragment = buildString {
            append("deviceId=")
            append(normalizedDeviceId)
            append("&code=")
            append(normalizedCode)
        }
        return portal.newBuilder()
            // A fragment is never sent to Vercel or included in HTTP access logs.
            .fragment(activationFragment)
            .build()
            .toString()
    }
}
