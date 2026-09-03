package tv.blofy.player.ui.profile

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
                    text = if (profile.kids) "🧒  ${profile.name}" else "👤  ${profile.name}"
                    textSize = 19f
                    typeface = Typeface.DEFAULT_BOLD
                    setTextColor(Color.WHITE)
                    gravity = Gravity.RIGHT
                })
                addView(TextView(this@ProfilesActivity).apply {
                    text = if (profile.kids) "وضع أطفال مع حماية PIN للمحتوى المقفل" else "المشاهدة والمفضلة والإعدادات الرئيسية"
                    textSize = 12f
                    setTextColor(BlofyTvDesign.TextMuted)
                    gravity = Gravity.RIGHT
                })
                setOnFocusChangeListener { view, focused ->
                    view.background = cardBg(profile.id == active.id, focused)
                    view.animate().cancel()
                    view.animate().scaleX(if (focused) 1.015f else 1f).scaleY(if (focused) 1.015f else 1f).setDuration(65).start()
                }
                setOnClickListener {
                    ProfileStore.select(this@ProfilesActivity, profile.id)
                    Toast.makeText(this@ProfilesActivity, "تم اختيار ${profile.name}", Toast.LENGTH_SHORT).show()
                    render()
                }
            }
            root.addView(card, LinearLayout.LayoutParams(-1, dp(92)).apply { bottomMargin = dp(9) })
            if (index == 0) card.post { card.requestFocus() }
        }

        root.addView(TextView(this).apply {
            text = "الحماية"
            textSize = 18f
            typeface = Typeface.DEFAULT_BOLD
            setTextColor(Color.WHITE)
            gravity = Gravity.RIGHT
            setPadding(0, dp(18), 0, dp(8))
        })
        val pin = EditText(this).apply {
            hint = if (ParentalGate.hasPin(this@ProfilesActivity)) "اكتب PIN جديد لتغييره" else "PIN من 4 إلى 8 أرقام"
            inputType = InputType.TYPE_CLASS_NUMBER or InputType.TYPE_NUMBER_VARIATION_PASSWORD
            isSingleLine = true
            setTextColor(Color.WHITE)
            setHintTextColor(BlofyTvDesign.TextMuted)
            background = fieldBg()
            setPadding(dp(16), 0, dp(16), 0)
        }
        root.addView(pin, LinearLayout.LayoutParams(-1, dp(58)).apply { bottomMargin = dp(9) })

        val actions = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; layoutDirection = View.LAYOUT_DIRECTION_RTL }
        actions.addView(actionButton("حفظ PIN") {
            if (ParentalGate.setPin(this, pin.text?.toString().orEmpty())) {
                Toast.makeText(this, "تم حفظ PIN", Toast.LENGTH_SHORT).show(); pin.text?.clear(); render()
            } else Toast.makeText(this, "اكتب من 4 إلى 8 أرقام", Toast.LENGTH_SHORT).show()
        }, LinearLayout.LayoutParams(0, dp(54), 1f).apply { marginStart = dp(8) })
        actions.addView(actionButton("إلغاء PIN") {
            ParentalGate.clearPin(this); Toast.makeText(this, "تم إلغاء PIN", Toast.LENGTH_SHORT).show(); render()
        }, LinearLayout.LayoutParams(0, dp(54), 1f))
        root.addView(actions)
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
