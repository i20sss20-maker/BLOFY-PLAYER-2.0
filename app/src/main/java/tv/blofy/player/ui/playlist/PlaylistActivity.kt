package tv.blofy.player.ui.playlist

import android.content.Intent
import android.graphics.Color
import android.os.Bundle
import android.view.Gravity
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import tv.blofy.player.data.PlaylistManager
import tv.blofy.player.data.local.BlofyDatabase
import tv.blofy.player.data.local.ProviderEntity
import tv.blofy.player.data.remote.XtreamClient
import tv.blofy.player.ui.home.HomeActivity
import java.util.UUID

class PlaylistActivity : AppCompatActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setPadding(60, 48, 60, 48)
            setBackgroundColor(Color.rgb(5, 5, 10))
        }
        root.addView(TextView(this).apply {
            text = "إضافة قائمة تشغيل"
            textSize = 28f
            setTextColor(Color.WHITE)
            gravity = Gravity.CENTER
        })

        fun field(hintText: String, password: Boolean = false) = EditText(this).apply {
            hint = hintText
            isSingleLine = true
            setTextColor(Color.WHITE)
            setHintTextColor(Color.GRAY)
            if (password) inputType = android.text.InputType.TYPE_CLASS_TEXT or android.text.InputType.TYPE_TEXT_VARIATION_PASSWORD
        }

        val name = field("اسم القائمة")
        val url = field("رابط السيرفر http://example.com:8080")
        val username = field("اسم المستخدم")
        val password = field("كلمة المرور", true)
        listOf(name, url, username, password).forEach {
            root.addView(it, LinearLayout.LayoutParams(620, LinearLayout.LayoutParams.WRAP_CONTENT).apply { topMargin = 12 })
        }

        val status = TextView(this).apply {
            setTextColor(Color.rgb(185, 140, 255))
            gravity = Gravity.CENTER
            setPadding(0, 16, 0, 4)
        }
        root.addView(status)

        val save = Button(this).apply {
            text = "حفظ واتصال"
            isAllCaps = false
            isFocusable = true
            setOnClickListener {
                val baseUrl = url.text.toString().trim()
                val user = username.text.toString().trim()
                val pass = password.text.toString()
                if (baseUrl.isBlank() || user.isBlank() || pass.isBlank()) {
                    status.text = "أكمل بيانات السيرفر"
                    return@setOnClickListener
                }
                isEnabled = false
                status.text = "جاري حفظ وتحميل القائمة..."
                lifecycleScope.launch {
                    runCatching {
                        withContext(Dispatchers.IO) {
                            val dao = BlofyDatabase.get(applicationContext).dao()
                            val id = UUID.nameUUIDFromBytes("$baseUrl|$user".toByteArray()).toString()
                            val provider = ProviderEntity(
                                id = id,
                                name = name.text.toString().trim().ifBlank { "BLOFY Server" },
                                baseUrl = baseUrl,
                                username = user,
                                password = pass
                            )
                            dao.upsertProvider(provider)
                            PlaylistManager(XtreamClient.api, dao).syncAll(provider)
                        }
                    }.onSuccess {
                        startActivity(Intent(this@PlaylistActivity, HomeActivity::class.java))
                        finish()
                    }.onFailure {
                        status.text = "تعذر تحميل القائمة: ${it.message ?: "خطأ اتصال"}"
                        isEnabled = true
                    }
                }
            }
        }
        root.addView(save, LinearLayout.LayoutParams(360, LinearLayout.LayoutParams.WRAP_CONTENT).apply { topMargin = 16 })
        setContentView(root)
        name.requestFocus()
    }
}
