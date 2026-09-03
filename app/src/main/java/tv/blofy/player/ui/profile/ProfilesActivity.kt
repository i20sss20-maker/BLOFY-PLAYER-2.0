package tv.blofy.player.ui.profile

import android.app.AlertDialog
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.text.InputType
import android.view.Gravity
import android.view.View
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.appcompat.content.res.AppCompatResources
import tv.blofy.player.R
import tv.blofy.player.core.profile.ProfileStore
import tv.blofy.player.core.security.ParentalGate
import tv.blofy.player.ui.common.BlofyTvDesign

class ProfilesActivity : AppCompatActivity() {
    private lateinit var root: LinearLayout

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            gravity = Gravity.TOP
            setPadding(dp(42), dp(30), dp(42), dp(30))
            background = AppCompatResources.getDrawable(this@ProfilesActivity, R.drawable.blofy_home_background)
        }
        setContentView(root)
        render()
    }

    private fun render() {
        root.removeAllViews()
        val active = ProfileStore.active(this)
        root.addView(TextView(this).apply {
            text = "الملفات الشخصية"
            textSize = 30f
            typeface = BlofyTvDesign.HeadingTypeface
            setTextColor(Color.WHITE)
            gravity = Gravity.RIGHT
        })
        root.addView(TextView(this).apply {
            text = "الملف الحالي: ${active.name}"
            textSize = 13f
            setTextColor(BlofyTvDesign.TextMuted)
            gravity = Gravity.RIGHT
            setPadding(0, dp(5), 0, dp(18))
        })

        ProfileStore.all(this).forEachIndexed { index, profile ->
            val card = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                gravity = Gravity.CENTER_VERTICAL or Gravity.RIGHT
                setPadding(dp(20), dp(12), dp(20), dp(12))
                isFocusable = true
                isClickable = true
                background = cardBg(profile.id == active.id, false)
                addView(TextView(this@ProfilesActivity).apply {
                    val lock = if (profile.pinHash != null) "  🔒" else ""
                    text = (if (profile.kids) "🧒  ${profile.name}" else "👤  ${profile.name}") + lock
                    textSize = 19f
                    typeface = Typeface.DEFAULT_BOLD
                    setTextColor(Color.WHITE)
                    gravity = Gravity.RIGHT
                })
                addView(TextView(this@ProfilesActivity).apply {
                    text = when {
                        profile.kids && profile.pinHash != null -> "وضع أطفال • محمي برمز PIN"
                        profile.kids -> "وضع أطفال • يمكن إضافة PIN خاص للملف"
                        else -> "المشاهدة والمفضلة والإعدادات الرئيسية"
                    }
                    textSize = 12f
                    setTextColor(BlofyTvDesign.TextMuted)
                    gravity = Gravity.RIGHT
                })
                setOnFocusChangeListener { view, focused ->
                    view.background = cardBg(profile.id == active.id, focused)
                    view.animate().cancel()
                    view.animate().scaleX(if (focused) 1.015f else 1f).scaleY(if (focused) 1.015f else 1f).setDuration(65).start()
                }
                setOnClickListener { selectProfile(profile) }
            }
            root.addView(card, LinearLayout.LayoutParams(-1, dp(92)).apply { bottomMargin = dp(9) })
            if (index == 0) card.post { card.requestFocus() }
        }

        root.addView(TextView(this).apply {
            text = "حماية الملف الحالي"
            textSize = 18f
            typeface = Typeface.DEFAULT_BOLD
            setTextColor(Color.WHITE)
            gravity = Gravity.RIGHT
            setPadding(0, dp(18), 0, dp(8))
        })
        val profilePin = EditText(this).apply {
            hint = if (active.pinHash != null) "اكتب PIN جديد لتغييره" else "PIN من 4 إلى 8 أرقام"
            inputType = InputType.TYPE_CLASS_NUMBER or InputType.TYPE_NUMBER_VARIATION_PASSWORD
            isSingleLine = true
            setTextColor(Color.WHITE)
            setHintTextColor(BlofyTvDesign.TextMuted)
            background = fieldBg()
            setPadding(dp(16), 0, dp(16), 0)
        }
        root.addView(profilePin, LinearLayout.LayoutParams(-1, dp(58)).apply { bottomMargin = dp(9) })

        val profileActions = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; layoutDirection = View.LAYOUT_DIRECTION_RTL }
        profileActions.addView(actionButton("حفظ PIN للملف") {
            val value = profilePin.text?.toString().orEmpty()
            if (value.length in 4..8 && value.all(Char::isDigit)) {
                ProfileStore.setPin(this, active.id, value)
                Toast.makeText(this, "تم حفظ PIN لملف ${active.name}", Toast.LENGTH_SHORT).show()
                render()
            } else Toast.makeText(this, "اكتب من 4 إلى 8 أرقام", Toast.LENGTH_SHORT).show()
        }, LinearLayout.LayoutParams(0, dp(54), 1f).apply { marginStart = dp(8) })
        profileActions.addView(actionButton("إلغاء PIN للملف") {
            ProfileStore.setPin(this, active.id, null)
            Toast.makeText(this, "تم إلغاء PIN للملف", Toast.LENGTH_SHORT).show()
            render()
        }, LinearLayout.LayoutParams(0, dp(54), 1f))
        root.addView(profileActions)

        root.addView(TextView(this).apply {
            text = "PIN المحتوى المقفل"
            textSize = 16f
            typeface = Typeface.DEFAULT_BOLD
            setTextColor(Color.WHITE)
            gravity = Gravity.RIGHT
            setPadding(0, dp(18), 0, dp(8))
        })
        val parentalPin = EditText(this).apply {
            hint = if (ParentalGate.hasPin(this@ProfilesActivity)) "اكتب PIN جديد لتغييره" else "PIN من 4 إلى 8 أرقام"
            inputType = InputType.TYPE_CLASS_NUMBER or InputType.TYPE_NUMBER_VARIATION_PASSWORD
            isSingleLine = true
            setTextColor(Color.WHITE)
            setHintTextColor(BlofyTvDesign.TextMuted)
            background = fieldBg()
            setPadding(dp(16), 0, dp(16), 0)
        }
        root.addView(parentalPin, LinearLayout.LayoutParams(-1, dp(58)).apply { bottomMargin = dp(9) })

        val parentalActions = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; layoutDirection = View.LAYOUT_DIRECTION_RTL }
        parentalActions.addView(actionButton("حفظ PIN للمحتوى") {
            if (ParentalGate.setPin(this, parentalPin.text?.toString().orEmpty())) {
                Toast.makeText(this, "تم حفظ PIN المحتوى", Toast.LENGTH_SHORT).show(); render()
            } else Toast.makeText(this, "اكتب من 4 إلى 8 أرقام", Toast.LENGTH_SHORT).show()
        }, LinearLayout.LayoutParams(0, dp(54), 1f).apply { marginStart = dp(8) })
        parentalActions.addView(actionButton("إلغاء PIN المحتوى") {
            ParentalGate.clearPin(this); Toast.makeText(this, "تم إلغاء PIN المحتوى", Toast.LENGTH_SHORT).show(); render()
        }, LinearLayout.LayoutParams(0, dp(54), 1f))
        root.addView(parentalActions)
    }

    private fun selectProfile(profile: ProfileStore.Profile) {
        if (profile.id == ProfileStore.active(this).id) return
        if (profile.pinHash == null) {
            activate(profile)
            return
        }
        val input = EditText(this).apply {
            hint = "PIN"
            inputType = InputType.TYPE_CLASS_NUMBER or InputType.TYPE_NUMBER_VARIATION_PASSWORD
            isSingleLine = true
            setPadding(dp(18), dp(6), dp(18), dp(6))
        }
        AlertDialog.Builder(this)
            .setTitle("فتح ملف ${profile.name}")
            .setMessage("أدخل رمز PIN الخاص بهذا الملف")
            .setView(input)
            .setNegativeButton("إلغاء", null)
            .setPositiveButton("فتح") { _, _ ->
                if (ProfileStore.verifyPin(profile, input.text?.toString().orEmpty())) activate(profile)
                else Toast.makeText(this, "PIN غير صحيح", Toast.LENGTH_SHORT).show()
            }
            .show()
    }

    private fun activate(profile: ProfileStore.Profile) {
        ProfileStore.select(this, profile.id)
        Toast.makeText(this, "تم اختيار ${profile.name}", Toast.LENGTH_SHORT).show()
        render()
    }

    private fun actionButton(label: String, action: () -> Unit) = Button(this).apply {
        text = label; isAllCaps = false; textSize = 14f; setTextColor(Color.WHITE); background = buttonBg(false)
        setOnFocusChangeListener { view, focused -> view.background = buttonBg(focused) }
        setOnClickListener { action() }
    }

    private fun cardBg(selected: Boolean, focused: Boolean) = GradientDrawable(GradientDrawable.Orientation.LEFT_RIGHT,
        when { focused -> intArrayOf(0xFF6D3FA0.toInt(), 0xFF352047.toInt()); selected -> intArrayOf(0xFF342248.toInt(), 0xFF20162C.toInt()); else -> intArrayOf(0xFF21172D.toInt(), 0xFF15101D.toInt()) }
    ).apply { cornerRadius = dp(16).toFloat(); setStroke(if (focused) dp(2) else dp(1), if (focused) 0xFFC690FF.toInt() else 0xFF4B385E.toInt()) }

    private fun fieldBg() = GradientDrawable().apply { cornerRadius = dp(14).toFloat(); setColor(0xFF20162B.toInt()); setStroke(dp(1), 0xFF513D67.toInt()) }
    private fun buttonBg(focused: Boolean) = GradientDrawable().apply { cornerRadius = dp(14).toFloat(); setColor(if (focused) 0xFF6B37A0.toInt() else 0xFF2A1C39.toInt()); setStroke(if (focused) dp(2) else dp(1), if (focused) 0xFFC690FF.toInt() else 0xFF513D67.toInt()) }
    private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()
}
