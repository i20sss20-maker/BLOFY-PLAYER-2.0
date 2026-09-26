package tv.blofy.player.core.identity

import android.content.Context
import android.provider.Settings
import java.security.MessageDigest
import java.security.SecureRandom

object DeviceIdentity {
    private const val PREFERENCES = "blofy_device_identity"
    private const val DEVICE_ID = "device_id_v2"
    private const val ACTIVE_CODE = "activation_code"
    private const val PENDING_CODE = "pending_activation_code"
    private const val STABLE_ALIAS_BOUND_TO = "stable_alias_bound_to"
    private const val DEVICE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    private const val DEVICE_ID_NAMESPACE = "tv.blofy.player/device-id/v3"
    private const val ACTIVATION_CODE_NAMESPACE = "tv.blofy.player/activation-code/v3"
    private const val LEGACY_BROKEN_ANDROID_ID = "9774d56d682e549c"
    private val secureRandom = SecureRandom()

    /**
     * Existing installations keep their already-issued BLOFY identity exactly as-is. The
     * activation service may bind a reinstall-stable recovery alias to that canonical identity,
     * but a normal update must never change the visible device ID or detach its server data.
     *
     * Fresh installations derive their public Device ID and six-digit activation credential from
     * Android's app-scoped system identity. This makes the BLOFY identity recoverable after an
     * uninstall/reinstall on the same Android user/device with the same production signing key,
     * instead of creating a new server device row every time the app is reinstalled.
     *
     * The raw Android identity is never sent to BLOFY services or displayed to the user. Only
     * namespace-separated SHA-256 derivatives are used. Devices that cannot expose a trustworthy
     * system identity fall back to the legacy random installation identity.
     */
    @Synchronized
    fun cachedIdentity(context: Context): Pair<String, String>? {
        val preferences = preferences(context)
        val deviceId = preferences.getString(DEVICE_ID, null)?.takeIf(::validDeviceId) ?: return null
        val activationCode = preferences.getString(ACTIVE_CODE, null)?.takeIf(::validActivationCode) ?: return null
        return deviceId to activationCode
    }

    @Synchronized
    fun deviceId(context: Context): String {
        val preferences = preferences(context)
        preferences.getString(DEVICE_ID, null)?.takeIf(::validDeviceId)?.let { return it }
        val generated = stableIdentity(context)?.first ?: generateDeviceId()
        return generated.also {
            check(preferences.edit().putString(DEVICE_ID, it).commit()) {
                "Unable to persist the device ID"
            }
        }
    }

    @Synchronized
    fun activationCode(context: Context): String {
        val preferences = preferences(context)
        preferences.getString(ACTIVE_CODE, null)?.takeIf(::validActivationCode)?.let { return it }
        val generated = stableIdentity(context)?.second ?: generateActivationCode()
        return generated.also {
            check(preferences.edit().putString(ACTIVE_CODE, it).commit()) {
                "Unable to persist the device activation code"
            }
        }
    }

    /** Returns the deterministic reinstall target without changing the currently active identity. */
    internal fun stableIdentity(context: Context): Pair<String, String>? = stableSystemIdentity(context)?.let {
        deriveDeviceId(it) to deriveActivationCode(it)
    }

    /** Room is authoritative for an upgraded install until Azure approves migration. */
    @Synchronized
    internal fun preserveExistingDeviceId(context: Context, deviceId: String) {
        require(validDeviceId(deviceId)) { "Invalid existing device ID" }
        val preferences = preferences(context)
        if (preferences.getString(DEVICE_ID, null) == deviceId) return
        check(preferences.edit().putString(DEVICE_ID, deviceId).commit()) {
            "Unable to preserve the existing BLOFY device ID"
        }
    }

    @Synchronized
    internal fun stableAliasAlreadyBound(context: Context, canonicalDeviceId: String): Boolean =
        preferences(context).getString(STABLE_ALIAS_BOUND_TO, null) == canonicalDeviceId

    @Synchronized
    internal fun markStableAliasBound(context: Context, canonicalDeviceId: String) {
        require(validDeviceId(canonicalDeviceId)) { "Invalid canonical device ID" }
        check(preferences(context).edit().putString(STABLE_ALIAS_BOUND_TO, canonicalDeviceId).commit()) {
            "Unable to persist stable recovery alias binding"
        }
    }

    /** Commits a server-approved canonical identity recovery after a clean reinstall. */
    @Synchronized
    internal fun commitStableIdentity(context: Context, deviceId: String, activationCode: String) {
        require(validDeviceId(deviceId)) { "Invalid stable device ID" }
        require(validActivationCode(activationCode)) { "Invalid stable activation code" }
        val expected = stableIdentity(context)
            ?: throw IllegalStateException("Stable system identity is unavailable")
        check(expected.first == deviceId && expected.second == activationCode) {
            "Stable identity does not match this device"
        }
        check(
            preferences(context).edit()
                .putString(DEVICE_ID, deviceId)
                .putString(ACTIVE_CODE, activationCode)
                .remove(PENDING_CODE)
                .commit()
        ) { "Unable to commit stable BLOFY identity" }
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
            // A consumer may have generated the new code before Room finished loading the
            // legacy identity. Preserve it as pending until the server authenticates rotation.
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

    internal fun deriveDeviceId(systemIdentity: String): String {
        val digest = digest(DEVICE_ID_NAMESPACE, systemIdentity)
        val raw = buildString(8) {
            repeat(8) { index ->
                val alphabetIndex = (digest[index].toInt() and 0xff) % DEVICE_ALPHABET.length
                append(DEVICE_ALPHABET[alphabetIndex])
            }
        }
        return "BLOFY-${raw.take(4)}-${raw.drop(4)}"
    }

    internal fun deriveActivationCode(systemIdentity: String): String {
        val digest = digest(ACTIVATION_CODE_NAMESPACE, systemIdentity)
        var value = 0L
        repeat(4) { index ->
            value = (value shl 8) or (digest[index].toLong() and 0xffL)
        }
        return (100_000L + (value % 900_000L)).toString()
    }

    internal fun generateDeviceId(nextInt: (Int) -> Int = secureRandom::nextInt): String {
        val raw = buildString(8) {
            repeat(8) { append(DEVICE_ALPHABET[nextInt(DEVICE_ALPHABET.length)]) }
        }
        return "BLOFY-${raw.take(4)}-${raw.drop(4)}"
    }

    internal fun generateActivationCode(nextInt: (Int) -> Int = secureRandom::nextInt): String =
        (100_000 + nextInt(900_000)).toString()

    private fun stableSystemIdentity(context: Context): String? = runCatching {
        Settings.Secure.getString(context.applicationContext.contentResolver, Settings.Secure.ANDROID_ID)
    }.getOrNull()
        ?.trim()
        ?.takeIf { value ->
            value.isNotEmpty() &&
                !value.equals("null", ignoreCase = true) &&
                !value.equals(LEGACY_BROKEN_ANDROID_ID, ignoreCase = true)
        }

    private fun digest(namespace: String, systemIdentity: String): ByteArray =
        MessageDigest.getInstance("SHA-256")
            .digest("$namespace:$systemIdentity".toByteArray(Charsets.UTF_8))

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
