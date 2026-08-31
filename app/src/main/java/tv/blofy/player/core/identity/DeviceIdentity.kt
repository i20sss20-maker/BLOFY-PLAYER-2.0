package tv.blofy.player.core.identity

import android.content.Context
import android.provider.Settings
import java.security.MessageDigest
import java.security.SecureRandom

object DeviceIdentity {
    private const val PREFERENCES = "blofy_device_identity"
    private const val ACTIVE_CODE = "activation_code"
    private const val PENDING_CODE = "pending_activation_code"
    private val secureRandom = SecureRandom()

    fun deviceId(context: Context): String {
        val androidId = Settings.Secure.getString(context.contentResolver, Settings.Secure.ANDROID_ID).orEmpty()
        val digest = sha256("blofy:$androidId:${context.packageName}")
        val code = digest.take(8).uppercase()
        return "BLOFY-${code.take(4)}-${code.drop(4)}"
    }

    @Synchronized
    fun activationCode(context: Context): String {
        val preferences = preferences(context)
        preferences.getString(ACTIVE_CODE, null)?.takeIf(::validActivationCode)?.let { return it }
        return generateActivationCode().also {
            check(preferences.edit().putString(ACTIVE_CODE, it).commit()) {
                "Unable to persist the device activation code"
            }
        }
    }

    /**
     * Migrates an already-installed app without changing its server credential
     * before an authenticated rotation succeeds.
     */
    @Synchronized
    fun reconcileExistingActivationCode(context: Context, existingCode: String): String {
        require(validActivationCode(existingCode)) { "Invalid existing activation code" }
        val preferences = preferences(context)
        val active = preferences.getString(ACTIVE_CODE, null)?.takeIf(::validActivationCode)
        val pending = preferences.getString(PENDING_CODE, null)?.takeIf(::validActivationCode)

        if (pending == existingCode) {
            check(preferences.edit().putString(ACTIVE_CODE, pending).remove(PENDING_CODE).commit()) {
                "Unable to finish activation-code rotation"
            }
            return pending
        }
        if (active == existingCode) return active
        if (active != null) {
            // A consumer may have generated the new random code before Room
            // finished loading the legacy identity. Preserve it as pending.
            val replacement = pending ?: active
            check(
                preferences.edit()
                    .putString(ACTIVE_CODE, existingCode)
                    .putString(PENDING_CODE, replacement)
                    .commit()
            ) {
                "Unable to reconcile the device activation code"
            }
            return existingCode
        }

        val replacement = generateDifferentActivationCode(existingCode)
        check(
            preferences.edit()
                .putString(ACTIVE_CODE, existingCode)
                .putString(PENDING_CODE, replacement)
                .commit()
        ) { "Unable to prepare legacy activation-code rotation" }
        return existingCode
    }

    @Synchronized
    fun pendingActivationCode(context: Context): String? = preferences(context)
        .getString(PENDING_CODE, null)
        ?.takeIf(::validActivationCode)

    @Synchronized
    fun scheduleActivationCodeRotation(context: Context): String {
        pendingActivationCode(context)?.let { return it }
        val current = activationCode(context)
        val pending = generateDifferentActivationCode(current)
        check(preferences(context).edit().putString(PENDING_CODE, pending).commit()) {
            "Unable to persist pending activation-code rotation"
        }
        return pending
    }

    @Synchronized
    fun commitActivationCodeRotation(context: Context, expectedCode: String) {
        require(validActivationCode(expectedCode)) { "Invalid activation code" }
        val preferences = preferences(context)
        check(preferences.getString(PENDING_CODE, null) == expectedCode) {
            "Activation-code rotation does not match the pending value"
        }
        check(preferences.edit().putString(ACTIVE_CODE, expectedCode).remove(PENDING_CODE).commit()) {
            "Unable to commit activation-code rotation"
        }
    }

    internal fun generateActivationCode(nextInt: (Int) -> Int = secureRandom::nextInt): String =
        (100_000 + nextInt(900_000)).toString()

    private fun generateDifferentActivationCode(current: String): String {
        var candidate: String
        do candidate = generateActivationCode() while (candidate == current)
        return candidate
    }

    private fun preferences(context: Context) =
        context.applicationContext.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)

    private fun validActivationCode(value: String): Boolean = value.matches(Regex("\\d{6}"))

    private fun sha256(value: String): String = MessageDigest.getInstance("SHA-256")
        .digest(value.toByteArray(Charsets.UTF_8))
        .joinToString("") { "%02x".format(it) }
}
