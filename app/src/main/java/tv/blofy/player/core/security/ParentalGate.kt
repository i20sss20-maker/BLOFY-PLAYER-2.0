package tv.blofy.player.core.security

import android.app.AlertDialog
import android.content.Context
import android.text.InputType
import android.widget.EditText
import java.security.MessageDigest

/** Real local parental PIN gate. No PIN configured = content opens normally. */
object ParentalGate {
    private const val PREFS = "blofy_parental"
    private const val KEY_HASH = "pin_hash"

    fun hasPin(context: Context): Boolean =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY_HASH, null).isNullOrBlank().not()

    fun setPin(context: Context, pin: String): Boolean {
        val clean = pin.trim()
        if (clean.length !in 4..8 || clean.any { !it.isDigit() }) return false
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(KEY_HASH, hash(clean)).apply()
        return true
    }

    fun clearPin(context: Context) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().remove(KEY_HASH).apply()
    }

    fun verify(context: Context, pin: String): Boolean {
        val saved = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY_HASH, null) ?: return true
        return saved == hash(pin.trim())
    }

    fun requirePin(context: Context, onGranted: () -> Unit) {
        if (!hasPin(context)) {
            onGranted()
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
                    input.error = "PIN غير صحيح"
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
