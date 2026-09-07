package tv.blofy.player.core.security

import android.app.AlertDialog
import android.content.Context
import android.text.InputType
import android.widget.EditText
import java.security.MessageDigest
import java.security.SecureRandom
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.PBEKeySpec
import kotlin.math.max
import kotlin.math.min

/**
 * Local parental PIN gate with brute-force protection and versioned PBKDF2 storage.
 * No PIN configured = content opens normally. Playback/catalog engines are untouched.
 */
object ParentalGate {
    private const val PREFS = "blofy_parental"
    private const val KEY_HASH = "pin_hash"
    private const val KEY_FAILED = "failed_attempts"
    private const val KEY_LOCKED_UNTIL = "locked_until"
    private const val MAX_ATTEMPTS = 5
    private const val PIN_SCHEME = "v2"
    private const val PIN_ITERATIONS = 120_000
    private const val PIN_BITS = 256
    private const val PIN_SALT_BYTES = 16
    private val secureRandom = SecureRandom()

    fun hasPin(context: Context): Boolean =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY_HASH, null).isNullOrBlank().not()

    fun setPin(context: Context, pin: String): Boolean {
        val clean = pin.trim()
        if (clean.length !in 4..8 || clean.any { !it.isDigit() }) return false
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putString(KEY_HASH, strongHash(clean))
            .remove(KEY_FAILED)
            .remove(KEY_LOCKED_UNTIL)
            .apply()
        return true
    }

    fun clearPin(context: Context) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .remove(KEY_HASH)
            .remove(KEY_FAILED)
            .remove(KEY_LOCKED_UNTIL)
            .apply()
    }

    fun lockRemainingMs(context: Context, now: Long = System.currentTimeMillis()): Long {
        val until = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getLong(KEY_LOCKED_UNTIL, 0L)
        return max(0L, until - now)
    }

    fun verify(context: Context, pin: String): Boolean {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val saved = prefs.getString(KEY_HASH, null) ?: return true
        val now = System.currentTimeMillis()
        if (lockRemainingMs(context, now) > 0L) return false

        val clean = pin.trim()
        val matches = if (saved.startsWith("$PIN_SCHEME$")) {
            verifyStrongHash(saved, clean)
        } else {
            // Old builds stored a single SHA-256 digest. Accept it once, then transparently migrate
            // the PIN to a salted PBKDF2 record so existing users are not locked out by an update.
            MessageDigest.isEqual(saved.hexToBytes() ?: ByteArray(0), legacyHash(clean).hexToBytes() ?: ByteArray(1))
        }

        if (matches) {
            val editor = prefs.edit().remove(KEY_FAILED).remove(KEY_LOCKED_UNTIL)
            if (!saved.startsWith("$PIN_SCHEME$")) editor.putString(KEY_HASH, strongHash(clean))
            editor.apply()
            return true
        }

        val failures = prefs.getInt(KEY_FAILED, 0) + 1
        if (failures >= MAX_ATTEMPTS) {
            val extraRounds = ((failures - MAX_ATTEMPTS) / MAX_ATTEMPTS).coerceAtLeast(0)
            val lockMs = min(5 * 60_000L, 30_000L shl extraRounds.coerceAtMost(3))
            prefs.edit()
                .putInt(KEY_FAILED, failures)
                .putLong(KEY_LOCKED_UNTIL, now + lockMs)
                .apply()
        } else {
            prefs.edit().putInt(KEY_FAILED, failures).apply()
        }
        return false
    }

    fun requirePin(context: Context, onGranted: () -> Unit) {
        if (!hasPin(context)) {
            onGranted()
            return
        }

        val initialLock = lockRemainingMs(context)
        if (initialLock > 0L) {
            val seconds = ((initialLock + 999L) / 1000L).coerceAtLeast(1L)
            AlertDialog.Builder(context)
                .setTitle("رمز الحماية")
                .setMessage("محاولات كثيرة. حاول مرة أخرى بعد $seconds ثانية.")
                .setPositiveButton("حسنًا", null)
                .show()
            return
        }

        val input = EditText(context).apply {
            hint = "PIN"
            inputType = InputType.TYPE_CLASS_NUMBER or InputType.TYPE_NUMBER_VARIATION_PASSWORD
            isSingleLine = true
            textAlignment = EditText.TEXT_ALIGNMENT_CENTER
        }
        val dialog = AlertDialog.Builder(context)
            .setTitle("رمز الحماية")
            .setMessage("أدخل PIN لفتح المحتوى المقفل")
            .setView(input)
            .setNegativeButton("إلغاء", null)
            .setPositiveButton("فتح", null)
            .create()
        dialog.setOnShowListener {
            dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener {
                if (verify(context, input.text?.toString().orEmpty())) {
                    dialog.dismiss()
                    onGranted()
                } else {
                    val remaining = lockRemainingMs(context)
                    if (remaining > 0L) {
                        val seconds = ((remaining + 999L) / 1000L).coerceAtLeast(1L)
                        input.error = "محاولات كثيرة. انتظر $seconds ثانية"
                    } else {
                        input.error = "PIN غير صحيح"
                    }
                    input.selectAll()
                }
            }
        }
        dialog.show()
    }

    private fun strongHash(value: String): String {
        val salt = ByteArray(PIN_SALT_BYTES).also(secureRandom::nextBytes)
        val derived = derive(value, salt, PIN_ITERATIONS)
        return "$PIN_SCHEME$$PIN_ITERATIONS$${salt.toHex()}$${derived.toHex()}"
    }

    private fun verifyStrongHash(stored: String, value: String): Boolean = runCatching {
        val parts = stored.split('$')
        if (parts.size != 4 || parts[0] != PIN_SCHEME) return false
        val iterations = parts[1].toIntOrNull()?.takeIf { it in 50_000..500_000 } ?: return false
        val salt = parts[2].hexToBytes() ?: return false
        val expected = parts[3].hexToBytes() ?: return false
        if (salt.size !in 12..32 || expected.size != PIN_BITS / 8) return false
        MessageDigest.isEqual(expected, derive(value, salt, iterations))
    }.getOrDefault(false)

    private fun derive(value: String, salt: ByteArray, iterations: Int): ByteArray {
        val spec = PBEKeySpec(value.toCharArray(), salt, iterations, PIN_BITS)
        return try {
            SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(spec).encoded
        } finally {
            spec.clearPassword()
        }
    }

    private fun legacyHash(value: String): String = MessageDigest.getInstance("SHA-256")
        .digest(("BLOFY|" + value).toByteArray(Charsets.UTF_8))
        .toHex()

    private fun ByteArray.toHex(): String = joinToString("") { "%02x".format(it) }

    private fun String.hexToBytes(): ByteArray? {
        if (length % 2 != 0 || !matches(Regex("[0-9a-fA-F]+"))) return null
        return runCatching {
            ByteArray(length / 2) { index -> substring(index * 2, index * 2 + 2).toInt(16).toByte() }
        }.getOrNull()
    }
}
