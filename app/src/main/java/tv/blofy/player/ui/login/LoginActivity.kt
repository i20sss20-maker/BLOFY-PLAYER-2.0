package tv.blofy.player.ui.login

import android.content.Intent
import android.graphics.Color
import android.os.Bundle
import android.view.Gravity
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import tv.blofy.player.core.identity.ActivationManager
import tv.blofy.player.data.local.BlofyDatabase
import tv.blofy.player.ui.home.HomeActivity
import tv.blofy.player.ui.playlist.PlaylistActivity

class LoginActivity : AppCompatActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setPadding(48, 48, 48, 48)
            setBackgroundColor(Color.rgb(5, 5, 10))
        }
        root.addView(TextView(this).apply {
            text = "BLOFY PLAYER"
            textSize = 34f
            setTextColor(Color.WHITE)
            gravity = Gravity.CENTER
        })
        root.addView(TextView(this).apply {
            text = "تشغيل ذكي. تجربة أسرع."
            textSize = 16f
            setTextColor(Color.rgb(185, 140, 255))
            gravity = Gravity.CENTER
            setPadding(0, 12, 0, 26)
        })

        val device = TextView(this).apply {
            text = "جاري إنشاء هوية الجهاز..."
            textSize = 17f
            setTextColor(Color.LTGRAY)
            gravity = Gravity.CENTER
        }
        val code = TextView(this).apply {
            textSize = 28f
            setTextColor(Color.WHITE)
            gravity = Gravity.CENTER
            setPadding(0, 8, 0, 24)
        }
        root.addView(device)
        root.addView(code)

        val addPlaylist = Button(this).apply {
            text = "إضافة قائمة التشغيل"
            isAllCaps = false
            isFocusable = true
            setOnClickListener { startActivity(Intent(this@LoginActivity, PlaylistActivity::class.java)) }
        }
        val home = Button(this).apply {
            text = "اتصال"
            isAllCaps = false
            isFocusable = true
            setOnClickListener { startActivity(Intent(this@LoginActivity, HomeActivity::class.java)) }
        }
        root.addView(addPlaylist, LinearLayout.LayoutParams(380, LinearLayout.LayoutParams.WRAP_CONTENT))
        root.addView(home, LinearLayout.LayoutParams(380, LinearLayout.LayoutParams.WRAP_CONTENT).apply { topMargin = 12 })
        setContentView(root)
        addPlaylist.requestFocus()

        lifecycleScope.launch {
            val identity = withContext(Dispatchers.IO) {
                ActivationManager(applicationContext, BlofyDatabase.get(applicationContext).dao()).ensureIdentity()
            }
            device.text = identity.deviceId
            code.text = identity.activationCode
        }
    }
}
