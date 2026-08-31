package tv.blofy.player.core.identity

import android.content.Context
import java.security.SecureRandom

object DeviceIdentity {
    private const val PREFERENCES = "blofy_device_identity"
    private const val DEVICE_ID = "device_id_v2"
    private const val ACTIVE_CODE = "activation_code"
    private const val PENDING_CODE = "pending_activation_code"
    private const val DEVICE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    private val secureRandom = SecureRandom()

    /**
     * Device IDs are installation-scoped, not derived from ANDROID_ID.
     *
     * This is intentional: after the app is deleted its local activation credential is lost.
     * Reusing the same deterministic Device ID with a newly generated activation code would
     * collide with the old server row and permanently reject the fresh install. A fresh install
     * now receives a fresh complete identity, while normal app updates keep the same ID because
     * this value remains in SharedPreferences.
     */
    @Synchronized
    fun deviceId(context: Context): String {
        val preferences = preferences(context)
        preferences.getString(DEVICE_ID, null)?.takeIf(::validDeviceId)?.let { return it }
        return generateDeviceId().also {
            check(preferences.edit().putString(DEVICE_ID, it).commit()) {
                "Unable to persist the device ID"
            }
        }
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

    internal fun generateDeviceId(nextInt: (Int) -> Int = secureRandom::nextInt): String {
        val raw = buildString(8) {
            repeat(8) { append(DEVICE_ALPHABET[nextInt(DEVICE_ALPHABET.length)]) }
        }
        return "BLOFY-${raw.take(4)}-${raw.drop(4)}"
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
    private fun validDeviceId(value: String): Boolean = value.matches(Regex("BLOFY-[A-Z0-9]{4}-[A-Z0-9]{4}"))
}
