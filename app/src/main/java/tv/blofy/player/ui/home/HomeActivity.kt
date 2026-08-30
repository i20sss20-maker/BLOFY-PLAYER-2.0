package tv.blofy.player.ui.home

import android.graphics.Color
import android.os.Bundle
import android.view.Gravity
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity

class HomeActivity : AppCompatActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(56, 44, 56, 44)
            setBackgroundColor(Color.rgb(5, 5, 10))
        }
        root.addView(TextView(this).apply {
            text = "BLOFY PLAYER 2.0"
            textSize = 30f
            setTextColor(Color.WHITE)
        })
        root.addView(TextView(this).apply {
            text = "الرئيسية"
            textSize = 16f
            setTextColor(Color.rgb(185, 140, 255))
            setPadding(0, 4, 0, 28)
        })

        val row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        listOf("البث المباشر", "الأفلام", "المسلسلات", "الإعدادات").forEach { label ->
            row.addView(Button(this).apply {
                text = label
                isAllCaps = false
                isFocusable = true
            }, LinearLayout.LayoutParams(0, 110, 1f).apply { marginEnd = 14 })
        }
        root.addView(row, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT))
        setContentView(root)
        row.getChildAt(0)?.requestFocus()
    }
}
