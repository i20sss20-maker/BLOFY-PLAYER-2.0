package tv.blofy.player.ui.login

import android.content.Intent
import android.graphics.Color
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import tv.blofy.player.ui.home.HomeActivity

class LoginActivity : AppCompatActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setPadding(48, 48, 48, 48)
            setBackgroundColor(Color.rgb(5, 5, 10))
        }
        val title = TextView(this).apply {
            text = "BLOFY PLAYER"
            textSize = 34f
            setTextColor(Color.WHITE)
            gravity = Gravity.CENTER
        }
        val subtitle = TextView(this).apply {
            text = "تشغيل ذكي. تجربة أسرع."
            textSize = 16f
            setTextColor(Color.rgb(185, 140, 255))
            gravity = Gravity.CENTER
            setPadding(0, 12, 0, 30)
        }
        val device = TextView(this).apply {
            text = "BLOFY DEVICE"
            setTextColor(Color.LTGRAY)
            gravity = Gravity.CENTER
            setPadding(0, 0, 0, 18)
        }
        val code = EditText(this).apply {
            hint = "رمز التفعيل"
            isSingleLine = true
            setTextColor(Color.WHITE)
            setHintTextColor(Color.GRAY)
            textDirection = View.TEXT_DIRECTION_RTL
        }
        val connect = Button(this).apply {
            text = "اتصال"
            isFocusable = true
            setOnClickListener { startActivity(Intent(this@LoginActivity, HomeActivity::class.java)) }
        }
        root.addView(title)
        root.addView(subtitle)
        root.addView(device)
        root.addView(code, LinearLayout.LayoutParams(520, LinearLayout.LayoutParams.WRAP_CONTENT))
        root.addView(connect, LinearLayout.LayoutParams(360, LinearLayout.LayoutParams.WRAP_CONTENT).apply { topMargin = 20 })
        setContentView(root)
        code.requestFocus()
    }
}
