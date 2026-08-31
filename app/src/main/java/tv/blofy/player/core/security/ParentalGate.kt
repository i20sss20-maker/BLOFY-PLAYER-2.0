package tv.blofy.player.core.security

import android.app.AlertDialog
import android.content.Context
import android.text.InputType
import android.widget.EditText

object ParentalGate {
    fun requirePin(context: Context, onGranted: () -> Unit) {
        if (!ParentalPinManager.hasPin(context)) {
            AlertDialog.Builder(context)
                .setTitle("إعداد الرقم السري")
                .setMessage("أنشئ رقمًا سريًا من 4 إلى 6 أرقام لفتح المحتوى المقفل.")
                .setView(pinInput(context))
                .setPositiveButton("حفظ", null)
                .setNegativeButton("إلغاء", null)
                .create().also { dialog ->
                    dialog.setOnShowListener {
                        dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener {
                            val input = dialog.findViewById<EditText>(android.R.id.edit)?.text?.toString().orEmpty()
                            if (ParentalPinManager.setPin(context, input)) {
                                dialog.dismiss(); onGranted()
                            }
                        }
                    }
                    dialog.show()
                }
            return
        }

        val input = pinInput(context)
        val dialog = AlertDialog.Builder(context)
            .setTitle("محتوى مقفل")
            .setMessage("أدخل الرقم السري")
            .setView(input)
            .setPositiveButton("فتح", null)
            .setNegativeButton("إلغاء", null)
            .create()
        dialog.setOnShowListener {
            dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener {
                if (ParentalPinManager.verify(context, input.text.toString())) {
                    dialog.dismiss(); onGranted()
                } else input.error = "الرقم السري غير صحيح"
            }
        }
        dialog.show()
    }

    private fun pinInput(context: Context) = EditText(context).apply {
        id = android.R.id.edit
        inputType = InputType.TYPE_CLASS_NUMBER or InputType.TYPE_NUMBER_VARIATION_PASSWORD
        isSingleLine = true
        hint = "PIN"
    }
}
