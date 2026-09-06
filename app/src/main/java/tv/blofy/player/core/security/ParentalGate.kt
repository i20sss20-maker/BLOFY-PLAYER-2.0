package tv.blofy.player.core.security

import android.app.AlertDialog
import android.content.Context
import android.text.InputType
import android.widget.EditText
import java.security.MessageDigest
import kotlin.math.max
import kotlin.math.min

/**
 * Local parental PIN gate with lightweight brute-force protection.
 * No PIN configured = content opens normally. Playback/catalog engines are untouched.
 */
object ParentalGate {
    private const val PREFS = "blofy_parental"
    private const val KEY_HASH = "pin_hash"
    private const val KEY_FAILED = "failed_attempts"
    private const val KEY_LOCKED_UNTIL = "locked_until"
    private const val MAX_ATTEMPTS = 5

    fun hasPin(context: Context): Boolean =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY_HASH, null).isNullOrBlank().not()

    fun setPin(context: Context, pin: String): Boolean {
        val clean = pin.trim()
        if (clean.length !in 4..8 || clean.any { !it.isDigit() }) return false
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putString(KEY_HASH, hash(clean))
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

        if (saved == hash(pin.trim())) {
            prefs.edit().remove(KEY_FAILED).remove(KEY_LOCKED_UNTIL).apply()
            return true
        }

        val failures = prefs.getInt(KEY_FAILED, 0) + 1
        if (failures >= MAX_ATTEMPTS) {
            // Escalate gently for repeated lockouts while keeping TV usability reasonable.
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

    private fun hash(value: String): String = MessageDigest.getInstance("SHA-256")
        .digest(("BLOFY|" + value).toByteArray(Charsets.UTF_8))
        .joinToString("") { "%02x".format(it) }
}
